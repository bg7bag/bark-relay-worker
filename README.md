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

## Step-by-step guides

The code in this repository is explained, step by step, in a series on BG7BAG Radio. The articles are written for an ordinary operator to follow by hand, with no assistant tool required to run them.

Bark setup:

- [iPhone Low-Power Instant Ham Radio Reminders](https://bg7bag.com/why-i-use-bark-for-reminders/) — why Bark, and what makes it fit field use.
- [One App, Two Websites: Instant Ham Radio Reminders](https://bg7bag.com/one-app-two-websites-instant-ham-radio-reminders/) — set up the relay in this repository, on your own Cloudflare account.
- [Satellite Pass Reminders by Hand: Start at 30 Degrees](https://bg7bag.com/satellite-pass-reminders-by-hand-start-at-30-degrees/) — a satellite pass reminder that needs no computer of your own; see `sat-worker/` below.

Bark + SDR, using the relay above plus a script on your recording computer:

- [Bark + SDR: Never Miss a Satellite Recording Again](https://bg7bag.com/bark-sdr-satellite-recording/) — watch a recording folder and push when a satellite recording finishes.
- [Bark + SDR: Get Pushed Only When the Repeater Talks](https://bg7bag.com/bark-sdr-repeater-watch/) — push only when squelch opens and a new recording file appears.
- [Bark + SDR: A Push When the Band Opens to You](https://bg7bag.com/bark-sdr-band-opening/) — watch the WSJT-X decode log and push on a matching frequency, mode and callsign.
- [Bark + SDR: Know When Recording Finishes or Fails](https://bg7bag.com/bark-sdr-recording-status/) — push when a long recording finishes, when disk space runs low, or when the expected file never appears.

Urgent alerts, using the relay above:

- [Urgent Alerts That Only Speak When It Matters](https://bg7bag.com/urgent-alerts-that-only-speak-when-it-matters/) — one Worker watches earthquakes, solar storms, and tsunami warnings, and pushes only when a threshold is really crossed; see `alert-worker/` below.

## In this repository

- `sdr-scripts/` — the four Python scripts for the Bark + SDR articles above, one per article: `01-satellite-recording.py`, `02-repeater-watch.py`, `03-band-opening.py`, `04-recording-status.py`. Each script takes only your relay address and passphrase; your Bark key is never in a script. Copy the script from its article or from Raw here, fill in your own values, and run it on your recording computer.
- `sat-worker/` — the satellite-pass reminder Worker from the third guide above. It runs on a cron schedule in Cloudflare, computes passes with satellite.js, and pushes through this relay. The folder's own README has the deploy outline. It contains no coordinates, keys or passphrases; fill in your own.
- `alert-worker/` — the urgent-alert Worker from the eighth guide above. It watches USGS earthquakes, NOAA solar storms and tsunami warnings, and GDACS Red alerts, and pushes title-only through this relay. The folder's own README has the thresholds, the duplication rules, and the deploy outline. It contains no keys or passphrases; fill in your own.

## Notes and limits

- Bark is iOS only. Android operators need a different push service (e.g. ntfy).
- The 10-minute throttle is best-effort in-memory state within a Worker isolate. For a strict throttle across isolates, back it with Workers KV.
- `BARK_SERVER` defaults to Bark's public `api.day.app`. For sensitive content, self-host `bark-server` and point `BARK_SERVER` at it.
- This project sends nothing to anyone except the Bark server you configure, and stores no messages.

## Roadmap

- Strict throttling backed by Workers KV (for this relay; `sat-worker/` already dedups with KV).
- An example DX spot filter (data source still to be decided — HamAlert vs. cluster feed).

## License

MIT. See [LICENSE](LICENSE).
