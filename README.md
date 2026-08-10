# stock-drop-alert

Checks whether a stock symbol has fallen **at least X% below its highest high
over the last N months**, and pings you on Telegram if it has.

Defaults to the question that started it: *has TQQQ dropped 25% from its
six-month high?* Any Yahoo Finance symbol works — `AAPL`, `BTC-USD`, `ASML.AS`,
`7203.T`.

The container runs one check and exits. Scheduling is Railway's job — point its
cron at this service and it will start the container on whatever cadence you set.

- Node 24 + `yahoo-finance2` for market data, `pino` for structured logs
- Single small Alpine image — no database, no server, no build step
- Exit code says what happened: `0` checked, `1` failed, `78` bad configuration

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

Whether it fired or not, the verdict lands in the logs:

```json
{"level":"info","peakPrice":88.09,"peakDate":"2026-06-03T13:30:00.000Z",
 "currentPrice":74.26,"dropPercent":15.7,"thresholdPercent":25,"triggered":false,
 "msg":"TQQQ is 15.7% below its 6-month high — below threshold"}
```

---

## Quick start (local)

Needs Node 22 or newer (`yahoo-finance2` requires it); the image uses Node 24.

```bash
cp .env.example .env      # then fill in TELEGRAM_URL
npm install
npm run dry-run           # evaluates and prints, never sends
npm start                 # evaluates and sends for real
```

With Docker:

```bash
docker build -t stock-drop-alert .
docker run --rm --env-file .env stock-drop-alert
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

### Throttling and runtime

| Variable | Default | Meaning |
| --- | --- | --- |
| `STATE_FILE` | *(unset)* | Where to remember the last alert, e.g. `/data/alert-state.json` |
| `ALERT_COOLDOWN_HOURS` | `24` | Stay quiet this long after an alert. Needs `STATE_FILE` |
| `DRY_RUN` | `false` | Evaluate and log, but never call the webhook |
| `LOG_LEVEL` | `info` | `trace`…`fatal`, or `silent` |
| `LOG_PRETTY` | `false` | Human-readable logs locally; falls back to JSON in the image |

Since every run is a fresh container, there is nowhere to remember a previous
alert unless you give it one. **Without `STATE_FILE`, every run that finds the
symbol below the threshold sends a message.** That is fine on a daily schedule
and noisy on an hourly one — if you want hourly checks but at most one message a
day, attach a volume and set `STATE_FILE` to a path on it.

---

## Deploying to Railway

Railway builds the `Dockerfile` automatically — no Nixpacks config, no build
command. Push this repo to GitHub and **New Project → Deploy from GitHub repo**,
or from the CLI:

```bash
railway init
railway up
```

Then, under **Service → Settings**:

- set the **Cron Schedule** to whenever you want the check to run, e.g.
  `0 21 * * 1-5` for once a day just after the US close (Railway reads cron in UTC);
- leave the restart policy on `NEVER` — [railway.json](railway.json) already sets
  it, since a job that exits cleanly should not be restarted.

Under **Service → Variables**, set `TELEGRAM_URL`. Everything else has a working
default, so `SYMBOL=TQQQ`, a 25% threshold and a 6-month window need no config
at all.

Railway starts the container on schedule, it checks, alerts if warranted, and
exits. A non-zero exit — Yahoo unreachable, webhook down, bad config — shows up
as a failed run rather than failing silently.

Optional: to throttle repeat alerts, attach a volume mounted at `/data` and set
`STATE_FILE=/data/alert-state.json`.

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
├── index.js                    entrypoint: load .env, build config + logger, run, exit
├── config.js                   validates the environment (zod), typed accessors
├── logger.js                   pino setup, with secret redaction
├── app.js                      composition root — builds the graph, runs one check
├── drop-watcher.js             one pass: fetch → analyse → decide → notify
├── price-history-provider.js   yahoo-finance2 wrapper, normalised candles
├── drawdown-analyzer.js        peak-finding and drop maths (pure, no I/O)
├── telegram-notifier.js        webhook call, retries, URL redaction
└── alert-state-store.js        cooldown bookkeeping, optionally on disk
```

Each class takes its collaborators through the constructor and keeps its internals
behind `#private` fields, so nothing reaches for global state and every piece can
be exercised on its own. `DrawdownAnalyzer` in particular is pure — hand it
candles, get a verdict — which is what the build-time smoke test leans on.

## Licence

MIT
