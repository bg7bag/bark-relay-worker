/**
 * bark-relay-worker — a minimal Cloudflare Worker that forwards a JSON
 * request to Bark (iOS push) and throttles duplicate messages.
 *
 * Deploy it to YOUR OWN Cloudflare account, with YOUR OWN Bark key.
 * Nobody else's phone is involved: this Worker only ever pushes to the
 * key you configure as a secret.
 *
 * Secrets (wrangler secret put):
 *   BARK_KEY      - your Bark device key (required)
 *   RELAY_SECRET  - optional shared secret; when set, every request must
 *                   carry header "X-Relay-Secret" with this value, so a
 *                   stranger who finds your Worker URL cannot push to
 *                   your phone.
 * Vars (wrangler.toml):
 *   BARK_SERVER   - default https://api.day.app, or your self-hosted
 *                   bark-server URL
 *   ALLOW_USER_KEYS - "true" only if you deliberately run a shared relay:
 *                   then a request may carry its own "device_key" and the
 *                   push goes to that key, not yours. Default off.
 *
 * Throttling: identical messages (same group + title + body) are sent
 * at most once per 10 minutes. This is a best-effort in-memory window:
 * it holds within a Worker isolate; for a strict cross-isolate throttle,
 * put the same key behind Workers KV (see README roadmap).
 */

const WINDOW_MS = 10 * 60 * 1000;
const seen = new Map(); // key -> timestamp ms

function throttleKey(group, title, body) {
  return `${group || ""}\n${title || ""}\n${body || ""}`;
}

function isDuplicate(key) {
  const now = Date.now();
  for (const [k, t] of seen) {
    if (now - t > WINDOW_MS) seen.delete(k);
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        "bark-relay-worker is running.\n" +
          "POST JSON to /push: {\"title\": \"...\", \"body\": \"...\", " +
          "\"group\": \"optional\", \"sound\": \"optional\", \"level\": \"optional\"}\n" +
          "Set BARK_KEY as a secret. If RELAY_SECRET is set, send header " +
          "X-Relay-Secret with it.\n",
        { headers: { "Content-Type": "text/plain" } }
      );
    }

    if (request.method !== "POST" || url.pathname !== "/push") {
      return new Response("Not found", { status: 404 });
    }

    if (env.RELAY_SECRET) {
      if (request.headers.get("X-Relay-Secret") !== env.RELAY_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("Expected a JSON body", { status: 400 });
    }
    const { title, body, group, sound, level } = payload;
    if (!title && !body) {
      return new Response("Provide at least a title or a body", { status: 400 });
    }

    const key = throttleKey(group, title, body);
    if (isDuplicate(key)) {
      return Response.json({ delivered: false, reason: "throttled-duplicate-10min" });
    }

    let deviceKey = env.BARK_KEY;
    if (env.ALLOW_USER_KEYS === "true" && payload.device_key) {
      deviceKey = payload.device_key;
    }
    if (!deviceKey) {
      return new Response("BARK_KEY secret is not configured", { status: 500 });
    }

    const server = (env.BARK_SERVER || "https://api.day.app").replace(/\/$/, "");
    const barkPayload = { device_key: deviceKey, title: title || "", body: body || "" };
    if (group) barkPayload.group = group;
    if (sound) barkPayload.sound = sound;
    if (level) barkPayload.level = level;

    const resp = await fetch(`${server}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(barkPayload),
    });
    if (!resp.ok) {
      seen.delete(key);
      const detail = (await resp.text()).slice(0, 200);
      return new Response(`Bark rejected the push (HTTP ${resp.status}): ${detail}`, { status: 502 });
    }
    return Response.json({ delivered: true });
  },
};
