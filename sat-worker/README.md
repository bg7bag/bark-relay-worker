# bark-sat-worker (cron version)

A Cloudflare Worker that runs on a cron schedule, computes amateur
satellite passes with satellite.js (SGP4), and pushes reminders through
[bark-relay-worker](../) to Bark on iOS.

This is the version that needs no computer of your own and no chat
assistant in the loop: once deployed, Cloudflare runs it every 5 minutes,
and Bark is the only thing that notifies you.

## What it does

- Every 5 minutes, fetches fresh TLE from CelesTrak for four satellites:
  ISS, SO-50, AO-91, RS-44.
- Finds passes with max elevation >= 30 degrees (70 degrees or more is
  marked "好圈" in the title).
- Pushes, via the relay Worker, only passes whose rise (AOS) is
  10-20 minutes away — about 15 minutes' notice.
- Dedups with a Workers KV namespace, so one pass is pushed only once.
- A reminder is geometric only: it does not guarantee the transponder
  is switched on (AO-91 is silent in eclipse, the ISS repeater is
  sometimes off).

## Secrets and vars (set in the Cloudflare dashboard, never in code)

- `SAT_LAT`, `SAT_LON` — your station latitude / longitude, as secrets.
- `RELAY_SECRET` — the relay Worker's shared passphrase, as a secret.
- `RELAY_URL` — the relay Worker's URL, as a plain-text var.
- `DEDUP` — a Workers KV namespace binding, for dedup.

## Deploy (outline)

1. `npm install satellite.js esbuild`
2. Bundle `src/index.js` with esbuild to a single ES module.
3. Upload the bundle as a Worker, bind the KV namespace, set the
   secrets and var above, and add a cron schedule `*/5 * * * *`
   (Workers API: PUT `/workers/scripts/<name>/schedules` with
   `[{"cron": "*/5 * * * *"}]`).
4. Check `GET /check` with the `X-Relay-Secret` header: it lists what
   would be pushed right now, without pushing. `GET /list` lists the
   next 24 hours of passes the same way.

No coordinates, keys, or passphrases are in this repo. Fill in your own.
