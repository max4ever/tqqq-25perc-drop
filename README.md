# stock-drop-alert

Watches a stock symbol and pings you on Telegram when it has fallen **at least X%
below its highest high over the last N months**.

Defaults to the question that started it: *has TQQQ dropped 25% from its
six-month high?* Any Yahoo Finance symbol works — `AAPL`, `BTC-USD`, `ASML.AS`,
`7203.T`.

- Node 24 + `yahoo-finance2` for market data, `pino` for structured logs
- Ships as a single small Alpine image — no database, no sidecar, no build step
- Runs on [Railway](https://railway.com) either as a long-running worker with its
  own cron, or as a one-shot job driven by Railway's native cron

```
📉 TQQQ (ProShares UltraPro QQQ) dropped 27.4% from its 6-month high.

Threshold: -25%
High:      88.09 USD on 2026-06-03
Now:       63.95 USD (2026-08-10)
Window:    2026-02-10 → 2026-08-10
```

---

## How it decides

1. Pull daily candles for `SYMBOL` covering the last `LOOKBACK_MONTHS` months.
2. Take the **highest intraday high** in that window — the peak.
3. Compare it to the current price (live quote, falling back to the last close).
4. `drop% = (peak − current) / peak × 100`. If that is `>= DROP_THRESHOLD_PERCENT`,
   call `TELEGRAM_URL`.
5. Stay quiet for `ALERT_COOLDOWN_HOURS` afterwards, so a symbol that sits below
   the threshold for a month doesn't produce one message per cron tick.

---

## Quick start (local)

Needs Node 22 or newer (`yahoo-finance2` requires it); the image uses Node 24.

```bash
cp .env.example .env      # then fill in TELEGRAM_URL
npm install
npm run dry-run           # evaluates and prints, never sends
npm run once              # evaluates and sends for real, then exits
npm start                 # long-running, cron-driven
```

With Docker:

```bash
docker build -t stock-drop-alert .
docker run --rm --env-file .env -e RUN_MODE=once stock-drop-alert
```

---

## Configuration

Every setting comes from an environment variable, or from a `.env` file when one
is present. See [.env.example](.env.example) for a copy-paste starting point.

### What to watch

| Variable | Default | Meaning |
| --- | --- | --- |
| `SYMBOL` | `TQQQ` | Ticker as Yahoo Finance knows it |
| `DROP_THRESHOLD_PERCENT` | `25` | Alert at this much below the window high |
| `LOOKBACK_MONTHS` | `6` | Length of the "highest high" window |

### Telegram

| Variable | Default | Meaning |
| --- | --- | --- |
| `TELEGRAM_URL` | **required** | The URL that delivers the message |
| `TELEGRAM_METHOD` | `GET` | `GET` or `POST` (POST also sends a JSON body) |
| `TELEGRAM_MESSAGE_PARAM` | `text` | Query parameter carrying the message |
| `TELEGRAM_TIMEOUT_MS` | `10000` | Per-attempt timeout |
| `TELEGRAM_RETRIES` | `3` | Extra attempts, with exponential backoff |

`TELEGRAM_URL` is deliberately open-ended — anything reachable over HTTP works.
There are two ways to say where the text goes:

**1. Put `{message}` in the URL.** It is replaced with the URL-encoded text:

```
TELEGRAM_URL=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text={message}
```

**2. Leave it out**, and the text is appended as `TELEGRAM_MESSAGE_PARAM`:

```
TELEGRAM_URL=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>
```

Both forms work equally well with CallMeBot, IFTTT webhooks, n8n, Make, or your
own endpoint — the app only cares that the call returns a 2xx.

<details>
<summary>Getting a bot token and chat id</summary>

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Send your new bot any message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[0].message.chat.id` — that is your chat id.

</details>

> The bot token and chat id are treated as secrets: the URL is redacted before it
> reaches the logs, so a leaked log line can't be replayed.

### Scheduling

| Variable | Default | Meaning |
| --- | --- | --- |
| `RUN_MODE` | `schedule` | `schedule` = stay up and self-schedule; `once` = check once and exit |
| `CHECK_CRON` | `0 * * * *` | Standard 5-field cron (hourly by default) |
| `CRON_TIMEZONE` | `UTC` | IANA zone the cron is read in, e.g. `America/New_York` |
| `RUN_ON_START` | `true` | Run one check at boot rather than waiting for the first tick |

Only `RUN_MODE=schedule` is used in a long-running container; `once` ignores the
cron settings entirely.

### Throttling, runtime, logging

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALERT_COOLDOWN_HOURS` | `24` | Silence after an alert. `0` disables throttling |
| `STATE_FILE` | *(unset)* | Persist the cooldown to disk, e.g. `/data/alert-state.json` |
| `HEALTH_SERVER` | `true` | Serve `/health` and `/status` (schedule mode only) |
| `PORT` | `3000` | Railway injects this automatically |
| `DRY_RUN` | `false` | Evaluate and log, but never call the webhook |
| `LOG_LEVEL` | `info` | `trace`…`fatal`, or `silent` |
| `LOG_PRETTY` | `false` | Human-readable logs locally; falls back to JSON in the image |

Without `STATE_FILE` the cooldown lives in memory, which is fine for
`RUN_MODE=schedule` but resets on every redeploy. In `RUN_MODE=once` you almost
certainly want `STATE_FILE` on a volume, otherwise every run starts with a clean
slate and you get an alert each time.

---

## Endpoints (schedule mode)

| Path | Response |
| --- | --- |
| `/health`, `/healthz`, `/` | `{"status":"ok","uptimeSeconds":…}` — for Railway's healthcheck |
| `/status` | Full config, next cron run, and the complete result of the last check |

`/status` is the fastest way to see where things stand without waiting for an alert:

```json
{
  "status": "ok",
  "nextRun": "2026-08-10T15:00:00.000Z",
  "lastCheck": {
    "peakPrice": 88.09,
    "peakDate": "2026-06-03T13:30:00.000Z",
    "currentPrice": 74.26,
    "dropPercent": 15.7,
    "thresholdPercent": 25,
    "remainingToThresholdPercent": 9.3,
    "priceAtThreshold": 66.07,
    "triggered": false
  }
}
```

---

## Deploying to Railway

Railway builds the `Dockerfile` automatically — no Nixpacks config, no build
command. Push this repo to GitHub and **New Project → Deploy from GitHub repo**,
or from the CLI:

```bash
railway init
railway up
```

Then set the variables under **Service → Variables**. At minimum `TELEGRAM_URL`;
everything else has a working default.

### Option A — long-running worker (recommended)

The default. The container stays up, runs its own cron, and answers `/health`.

```
RUN_MODE=schedule
CHECK_CRON=0 13-21 * * 1-5        # hourly during US market hours
CRON_TIMEZONE=America/New_York
TELEGRAM_URL=...
```

Set the healthcheck path to `/health` under **Settings → Deploy**. One always-on
container is a rounding error on Railway's usage-based billing (idle Node, ~60 MB
RSS), and it survives sleep/wake because `RUN_ON_START=true` re-checks on boot.

### Option B — Railway cron job

Railway's native cron starts the container on a schedule and expects it to exit.

```
RUN_MODE=once
STATE_FILE=/data/alert-state.json
TELEGRAM_URL=...
```

Set **Settings → Cron Schedule** to e.g. `0 * * * *`, and attach a volume mounted
at `/data` so the cooldown survives between runs. The process exits `0` on a
clean check and non-zero if the fetch or the webhook failed, so failed runs show
up as failed in Railway.

---

## Image size

`node:24-alpine` plus about 20 MB of application layers.

`yahoo-finance2` hard-depends on the MCP server SDK, which drags in hono, express,
ajv and friends — none of which this app ever imports. The build walks the real
dependency graph from the packages actually imported and drops everything
unreachable ([scripts/prune-modules.mjs](scripts/prune-modules.mjs)), removes the
CJS mirror of `yahoo-finance2`, and strips `npm`/`corepack` from the runtime
layer. That's ~40 MB off the image.

Because an over-eager prune would only surface at runtime, the build runs
[scripts/smoke-test.mjs](scripts/smoke-test.mjs) immediately afterwards: it
resolves every module, constructs the whole object graph, and checks the drawdown
maths. If the prune broke something, `docker build` fails.

---

## Layout

```
src/
├── index.js                    entrypoint: load .env, build config + logger, start
├── config.js                   validates the environment (zod), typed accessors
├── logger.js                   pino setup, with secret redaction
├── app.js                      composition root + lifecycle (cron, signals, health)
├── drop-watcher.js             one pass: fetch → analyse → decide → notify
├── price-history-provider.js   yahoo-finance2 wrapper, normalised candles
├── drawdown-analyzer.js        peak-finding and drop maths (pure, no I/O)
├── telegram-notifier.js        webhook call, retries, URL redaction
├── alert-state-store.js        cooldown bookkeeping, optionally on disk
└── health-server.js            /health and /status
```

Each class takes its collaborators through the constructor and keeps its internals
behind `#private` fields, so nothing reaches for global state and every piece can
be exercised on its own. `DrawdownAnalyzer` in particular is pure — hand it
candles, get a verdict — which is what the build-time smoke test leans on.

## Licence

MIT
