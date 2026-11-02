# bark-relay-worker

A minimal Cloudflare Worker that forwards a JSON request to [Bark](https://github.com/Finb/Bark) (iOS push notifications) and throttles duplicates.

**Problem it solves, in 30 seconds:** any script that can make an HTTP request — a repeater monitor, a DX spot filter, a station watchdog — can push a notification to your iPhone with one `curl`, without leaving a computer switched on and without giving a stranger a way to push to your phone.

## Deploy to your own account (5 minutes)

1. Install [Bark](https://apps.apple.com/app/id1403753865) on your iPhone and copy your device key.
2. Deploy this Worker to **your own** Cloudflare account:
   ```sh
   npm install -g wrangler
   wrangler login
   wrangler deploy
   ```
   Or import this repository in the Cloudflare dashboard (Workers → Create → Import a repository).
3. Set your secrets (never commit them):
   ```sh
   wrangler secret put BARK_KEY
   wrangler secret put RELAY_SECRET   # optional but recommended
   ```
4. Test it:
   ```sh
   curl -X POST https://bark-relay-worker.<your-subdomain>.workers.dev/push \
     -H "Content-Type: application/json" \
     -H "X-Relay-Secret: <your RELAY_SECRET, if set>" \
     -d '{"title": "Repeater offline", "body": "No response for 5 minutes", "group": "station"}'
   ```
   Your phone should buzz within seconds.

## How it works

- `POST /push` with JSON: `title`, `body`, optional `group`, `sound`, `level`.
- **Throttling:** an identical message (same group + title + body) is delivered at most once per 10 minutes, so a flapping monitor cannot spam your phone.
- **Shared secret:** when `RELAY_SECRET` is set, requests without the matching `X-Relay-Secret` header are rejected with 401. Set it — otherwise anyone who finds your Worker URL can push to your phone.
- **Your key only:** by default the Worker pushes only to the `BARK_KEY` you configured. Nobody else's phone is involved.

## Sharing this with other hams

Share the **code**, not your deployment: let each ham deploy it to their own Cloudflare account with their own Bark key. If you deliberately want to run one shared relay, set `ALLOW_USER_KEYS = "true"` in `wrangler.toml` — then a request may carry its own `device_key` and the push goes to that key, not yours. Keys sent that way pass through your Worker, so only do this for people you trust, and keep rate limits in mind (Cloudflare's free tier).

## Amateur radio uses

- Repeater / station watchdog: offline, high temperature, high SWR.
- DX spot alerts: filter a cluster feed for the DXCC, band or mode you want, then push.
- Satellite passes and band openings: push a reminder a few minutes before the window.
- Emergency net activation: push only the operators on duty.

## Notes and limits

- Bark is iOS only. Android operators need a different push service (e.g. ntfy).
- The 10-minute throttle is best-effort in-memory state within a Worker isolate. For a strict throttle across isolates, back it with Workers KV.
- `BARK_SERVER` defaults to Bark's public `api.day.app`. For sensitive content, self-host `bark-server` and point `BARK_SERVER` at it.
- This project sends nothing to anyone except the Bark server you configure, and stores no messages.

## Roadmap

- Strict throttling backed by Workers KV.
- An example DX spot filter (data source still to be decided — HamAlert vs. cluster feed).
- An example satellite-pass reminder.

## License

MIT. See [LICENSE](LICENSE).
