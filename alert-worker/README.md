# bark-alert-worker

A Cloudflare Worker that watches earthquakes, solar storms, and tsunami warnings for you, and pushes only when a threshold is really crossed. It pushes through the Bark relay in the parent repository, title-only, so the push is spoken aloud in full from a speaker.

Explained step by step, with the full code, in the eighth guide in the series:
[Urgent Alerts That Only Speak When It Matters](https://bg7bag.com/urgent-alerts-that-only-speak-when-it-matters/)

## Thresholds, exactly as in the article

- Earthquake: USGS magnitude 6.0 or more.
- Solar storm: NOAA Kp index 7 or more, that is G3 or more.
- Solar flare: GOES X-ray flux at X-class (1e-4 W/m2 or more).
- Tsunami: NWS Tsunami Warning only, not Watch or Advisory.
- Other disasters: GDACS Red only, excluding GDACS earthquake items (USGS already covers those, faster).

## Sources, and why only these

Only official, first-hand, long-lived feeds: USGS GeoJSON, NOAA SWPC JSON, the NWS API, and GDACS RSS. No social media, no second-hand aggregators, no page scraping. See the article for the full reliability and stability reasoning, and for the pros and cons of each source.

## Duplication, handled on purpose

- USGS and GDACS both report big earthquakes, so GDACS earthquake items are dropped outright. GDACS in this Worker only adds floods, tropical cyclones, volcanoes, and similar Red events.
- An earthquake and a tsunami Warning for the same event are kept as separate events, because they call for different actions.
- Kp and X-ray flux are kept both, because they measure different things: a flare, and what it does to Earth's magnetic field hours later.
- Every other event is deduped by source plus its own event id, in Workers KV. Kp is an index, not an event, so it pushes at most once every six hours while Kp stays at 7 or more.

## Deploy outline

1. Deploy the Bark relay from the parent repository first, and note its address and passphrase.
2. In Cloudflare, create a Worker named `bark-alert-worker`, paste `index.js` here, and deploy.
3. Set `RELAY_URL` (plain variable, relay address without `/push`) and `RELAY_SECRET` (secret, same passphrase as the relay).
4. Create a KV namespace named `bark-alert-dedup` and bind it as `DEDUP`.
5. Add a cron trigger `*/5 * * * *` (every five minutes).
6. Open the Worker address with `/check` at the end. An empty list most days is normal. Do not trust it until `/check` opens cleanly and the KV binding is in place.

This folder contains no keys, passphrases, coordinates, or personal data. Fill in your own values in Cloudflare, never in the code.
