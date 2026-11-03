/**
 * bark-sat-worker — Cloudflare Worker (cron version) for amateur satellite
 * pass reminders, pushing through bark-relay-worker to Bark (iOS).
 *
 * This Worker does NOT run on Muse, on a chat, or on the reader's computer:
 * Cloudflare runs it on a cron schedule, it fetches fresh TLE from CelesTrak,
 * computes passes with satellite.js (SGP4), and pushes via the relay Worker.
 * The reader's own coordinates and the relay passphrase live ONLY as
 * Worker secrets (SAT_LAT, SAT_LON, RELAY_SECRET) — never in this code,
 * never in a public repo. The relay URL is a plain-text var (RELAY_URL).
 *
 * Endpoints:
 *   GET /            running text (no data, no secrets)
 *   GET /list        upcoming passes, next 48 h, requires X-Relay-Secret
 *   GET /check       dry-run of the scheduled check, requires X-Relay-Secret
 * Scheduled (cron, every 5 min): push passes whose AOS is 10-20 min away
 *   and whose max elevation is >= 30 deg; >= 70 deg is marked "好圈".
 * Dedup: KV binding DEDUP when present (key sat|AOS rounded to the
 *   minute, 1 h TTL — rounding matters: the raw AOS timestamp carries
 *   milliseconds that shift between cron runs, which made the old
 *   millisecond-precision key miss every duplicate);
 *   otherwise best-effort in-memory (same isolate only).
 *
 * Satellites (verified against AMSAT tables, 2026-10-31 editions):
 *   ISS   FM,  up 145.990 (67.0 Hz), down 437.800
 *   SO-50 FM,  up 145.850 (67.0 Hz, arm first with 74.4 Hz for 2 s), down 436.795
 *   AO-91 FM,  up 435.250 (67.0 Hz), down 145.960
 *   RS-44 SSB linear (inverting), up 145.935-145.995 LSB,
 *         down 435.610-435.670 USB, beacon 435.605 CW
 * A reminder is geometric only: it does not guarantee the transponder is on
 * (AO-91 is silent in eclipse, the ISS repeater is sometimes off).
 */
import * as satellite from 'satellite.js';

const SATS = [
  { code: 'ISS', name: '国际空间站', norad: 25544, mode: 'FM',
    up: '145.990（亚音 67.0）', down: '437.800' },
  { code: 'SO-50', name: '沙特卫星 1C', norad: 27607, mode: 'FM',
    up: '145.850（亚音 67.0，先用 74.4 发 2 秒开机）', down: '436.795' },
  { code: 'AO-91', name: '狐狸 1B', norad: 43017, mode: 'FM',
    up: '435.250（亚音 67.0）', down: '145.960' },
  { code: 'RS-44', name: '俄罗斯 DOSAAF-85', norad: 44909, mode: 'SSB',
    up: '145.935–145.995（LSB）', down: '435.610–435.670（USB），信标 435.605' },
];
const THRESHOLD_DEG = 30;
const GOOD_DEG = 70;
const seen = new Map();

async function fetchTle(norad) {
  const res = await fetch(
    `https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=tle`,
    { headers: { 'User-Agent': 'bark-sat-worker' } });
  if (!res.ok) throw new Error(`TLE ${norad} HTTP ${res.status}`);
  const lines = (await res.text()).trim().split('\n');
  return [lines[1].trim(), lines[2].trim()];
}

function elevationDeg(satrec, date, observer) {
  const pv = satellite.propagate(satrec, date);
  if (!pv.position) return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observer, ecf);
  return satellite.degreesToRadians ? look.elevation * 180 / Math.PI : look.elevation;
}

function findPasses(satrec, start, end, observer, stepMs = 30000) {
  const passes = [];
  let cur = null;
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const date = new Date(t);
    const el = elevationDeg(satrec, date, observer);
    if (el !== null && el > 0) {
      if (!cur) cur = { aos: date, max: el };
      else if (el > cur.max) cur.max = el;
    } else if (cur) {
      cur.los = date;
      passes.push(cur);
      cur = null;
    }
  }
  if (cur) { cur.los = end; passes.push(cur); }
  return passes.filter((p) => p.max >= THRESHOLD_DEG);
}

function fmtShanghai(date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function payloadFor(sat, p, short) {
  const good = p.max >= GOOD_DEG ? '好圈' : '';
  // Scheduled pushes stay short so the phone can speak them: title +
  // start time only. The frequency, mode, max elevation and duration
  // details stay in /list, which is read on screen, not spoken.
  if (short) {
    return {
      title: `${good}${sat.name} 15分钟后过顶`,
      body: `起 ${fmtShanghai(p.aos)}`,
      group: 'sat-pass',
    };
  }
  return {
    title: `${good}${sat.name} 15分钟后过顶`,
    body: `起 ${fmtShanghai(p.aos)}，最高 ${Math.round(p.max)} 度，` +
      `约 ${Math.round((p.los - p.aos) / 60000)} 分钟；${sat.mode}；` +
      `上行 ${sat.up}，下行 ${sat.down}`,
    group: 'sat-pass',
  };
}

async function pushViaRelay(env, payload) {
  const res = await fetch(`${env.RELAY_URL.replace(/\/$/, '')}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': env.RELAY_SECRET },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: (await res.text()).slice(0, 200) };
}

async function checkPasses(env, now, hours, windowMin, windowMax, stepMs = 30000, short = false) {
  const lat = parseFloat(env.SAT_LAT);
  const lon = parseFloat(env.SAT_LON);
  const observer = {
    latitude: satellite.degreesToRadians(lat),
    longitude: satellite.degreesToRadians(lon),
    height: 0.07,
  };
  const results = [];
  for (const sat of SATS) {
    let tle;
    try { tle = await fetchTle(sat.norad); }
    catch (e) { results.push({ sat: sat.code, error: String(e) }); continue; }
    const satrec = satellite.twoline2satrec(tle[0], tle[1]);
    const passes = findPasses(satrec, now, new Date(now.getTime() + hours * 3600000), observer, stepMs);
    for (const p of passes) {
      const minutes = (p.aos - now) / 60000;
      const pl = payloadFor(sat, p, short);
      if (windowMin === null || (minutes >= windowMin && minutes <= windowMax)) {
        results.push({ sat: sat.code, aos: p.aos.toISOString(), max: Math.round(p.max), payload: pl });
      } else if (windowMin === null) {
        results.push({ sat: sat.code, aos: p.aos.toISOString(), max: Math.round(p.max), payload: pl });
      }
    }
  }
  return results;
}

async function alreadySent(env, key) {
  if (env.DEDUP) {
    const v = await env.DEDUP.get(key);
    if (v) return true;
    await env.DEDUP.put(key, '1', { expirationTtl: 3600 });
    return false;
  }
  if (seen.has(key)) return true;
  seen.set(key, Date.now());
  return false;
}

async function doScheduled(env, now) {
  const out = [];
  const found = await checkPasses(env, now, 1, 10, 20, 30000, true);
  for (const f of found) {
    if (!f.payload) { out.push(f); continue; }
    // Round AOS to the minute before keying: the raw AOS carries
    // milliseconds that shift between cron runs, so a millisecond key
    // never matches the previous run and duplicates slip through.
    const aosMin = new Date(f.aos);
    aosMin.setSeconds(0, 0);
    const key = `${f.sat}|${aosMin.toISOString()}`;
    if (await alreadySent(env, key)) { out.push({ ...f, skipped: 'duplicate' }); continue; }
    const r = await pushViaRelay(env, f.payload);
    out.push({ ...f, push: r });
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('bark-sat-worker is running.\n', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (request.method === 'GET' && (url.pathname === '/list' || url.pathname === '/check')) {
      if (env.RELAY_SECRET && request.headers.get('X-Relay-Secret') !== env.RELAY_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      const now = new Date();
      if (url.pathname === '/list') {
        const found = await checkPasses(env, now, 24, null, null, 60000);
        return Response.json({ now: now.toISOString(), passes: found });
      }
      // /check is dry-run only: list what WOULD be pushed, never push.
      // It mirrors the scheduled push, so it uses the short format.
      const found = await checkPasses(env, now, 1, 10, 20, 30000, true);
      return Response.json({ now: now.toISOString(), would_push: found });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(doScheduled(env, new Date()));
  },
};
