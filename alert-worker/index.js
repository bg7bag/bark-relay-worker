async function push(env, title) {
  const res = await fetch(env.RELAY_URL + '/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': env.RELAY_SECRET },
    body: JSON.stringify({ title: title })
  });
  return res.ok;
}
async function alreadyPushed(env, key) {
  if (env.DEDUP) {
    const v = await env.DEDUP.get(key);
    if (v) { return true; }
    await env.DEDUP.put(key, '1');
  }
  return false;
}
function itemText(xml, tag) {
  const a = xml.indexOf('<' + tag + '>');
  if (a === -1) { return ''; }
  const b = xml.indexOf('</' + tag + '>', a);
  if (b === -1) { return ''; }
  return xml.slice(a + tag.length + 2, b).trim();
}
async function checkQuakes(env, out) {
  const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
  if (r.ok) {
    const data = await r.json();
    const feats = data.features || [];
    for (let i = 0; i < feats.length; i++) {
      const p = feats[i].properties || {};
      if (p.mag >= 6.0) {
        const key = 'usgs-' + feats[i].id;
        if (await alreadyPushed(env, key)) { continue; }
        const d = new Date(p.time);
        const t = (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
        out.push('地震 M' + p.mag + ' ' + t);
      }
    }
  }
}
async function checkKp(env, out) {
  const r = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
  if (r.ok) {
    const data = await r.json();
    const last = data[data.length - 1];
    if (last) {
      const kp = Number(last.kp_index);
      if (kp >= 7) {
        const lastPush = env.DEDUP ? await env.DEDUP.get('kp-last') : null;
        const now = Date.now();
        if (lastPush === null) { if (env.DEDUP) { await env.DEDUP.put('kp-last', String(now)); } out.push('太阳风暴 G3 Kp' + kp); }
        else {
          if (now - Number(lastPush) > 6 * 3600 * 1000) { if (env.DEDUP) { await env.DEDUP.put('kp-last', String(now)); } out.push('太阳风暴 G3 Kp' + kp); }
        }
      }
    }
  }
}
async function checkFlare(env, out) {
  const r = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json');
  if (r.ok) {
    const data = await r.json();
    const last = data[data.length - 1];
    if (last) {
      const flux = Number(last.flux);
      if (flux >= 0.0001) {
        const key = 'goes-' + last.time_tag;
        if (await alreadyPushed(env, key)) { return; }
        out.push('太阳耀斑 X级 ' + last.time_tag);
      }
    }
  }
}
async function checkTsunami(env, out) {
  const r = await fetch('https://api.weather.gov/alerts/active?event=Tsunami%20Warning', { headers: { 'User-Agent': 'bark-alert-worker' } });
  if (r.ok) {
    const data = await r.json();
    const feats = data.features || [];
    for (let i = 0; i < feats.length; i++) {
      const p = feats[i].properties || {};
      const key = 'nws-' + feats[i].id;
      if (await alreadyPushed(env, key)) { continue; }
      const area = (p.areaDesc || '').slice(0, 40);
      out.push('海啸预警 ' + area);
    }
  }
}
async function checkGdacs(env, out) {
  const r = await fetch('https://www.gdacs.org/xml/rss.xml');
  if (r.ok) {
    const xml = await r.text();
    const parts = xml.split('<item>');
    for (let i = 1; i < parts.length; i++) {
      const level = itemText(parts[i], 'gdacs:alertlevel');
      const etype = itemText(parts[i], 'gdacs:eventtype');
      if (level !== 'Red') { continue; }
      if (etype === 'EQ') { continue; }
      const guid = itemText(parts[i], 'guid');
      const key = 'gdacs-' + guid;
      if (await alreadyPushed(env, key)) { continue; }
      const title = itemText(parts[i], 'title').replace('&amp;', 'and');
      out.push('GDACS 红色 ' + title.slice(0, 60));
    }
  }
}
async function checkAll(env, dry) {
  const out = [];
  try { await checkQuakes(env, out); } catch (e) {}
  try { await checkKp(env, out); } catch (e) {}
  try { await checkFlare(env, out); } catch (e) {}
  try { await checkTsunami(env, out); } catch (e) {}
  try { await checkGdacs(env, out); } catch (e) {}
  if (dry === false) {
    for (let i = 0; i < out.length; i++) { await push(env, out[i]); }
  }
  return out;
}
export default {
  async scheduled(event, env, ctx) { await checkAll(env, false); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/check') {
      const out = await checkAll(env, true);
      return new Response(JSON.stringify({ would_push: out }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('bark-alert-worker is running.');
  }
};
