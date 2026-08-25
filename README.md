# stock-drop-alert

Checks whether a stock symbol has fallen **at least X% below its highest high
over the last N months**, and sends you a Telegram message if it has. Once a
month it also messages you when it hasn't, so you know it is still watching.

Defaults to the question that started it: *has TQQQ dropped 25% from its
six-month high?* Any Yahoo Finance symbol works — `AAPL`, `BTC-USD`, `ASML.AS`,
`7203.T`.

The container is stateless: it runs one check, sends at most one message, and
exits. Scheduling it is somebody else's job.

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
   send the message. If it isn't, send [the monthly digest](#the-monthly-digest)
   instead — but only on digest day.

Whether it fired or not, the verdict lands in the logs:

```json
{"level":"info","peakPrice":88.09,"peakDate":"2026-06-03T13:30:00.000Z",
 "currentPrice":74.26,"dropPercent":15.7,"thresholdPercent":25,"triggered":false,
 "msg":"TQQQ is 15.7% below its 6-month high — below threshold"}
```

---

## Running it

```bash
docker build -t stock-drop-alert .
docker run --rm --env-file .env stock-drop-alert
```

Or pass the variables straight in, no `.env` needed:

```bash
docker run --rm \
  -e SYMBOL=TQQQ \
  -e DROP_THRESHOLD_PERCENT=25 \
  -e LOOKBACK_MONTHS=6 \
  -e TELEGRAM_BOT_TOKEN=123456789:AAExample-Token \
  -e TELEGRAM_CHAT_ID=987654321 \
  stock-drop-alert
```

The exit code says what happened, so a scheduler can tell a quiet check from a
broken one:

| Code | Meaning |
| --- | --- |
| `0` | Checked — message sent, or threshold not reached |
| `1` | Yahoo unreachable, or Telegram refused the message |
| `78` | Bad configuration, with the offending variables named |

---

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SYMBOL` | `TQQQ` | Ticker as Yahoo Finance knows it |
| `DROP_THRESHOLD_PERCENT` | `25` | Alert at this much below the window high |
| `LOOKBACK_MONTHS` | `6` | Length of the "highest high" window |
| `TELEGRAM_BOT_TOKEN` | **required** | From @BotFather, including the part before the colon |
| `TELEGRAM_CHAT_ID` | **required** | Negative for groups, `@name` for channels |
| `MONTHLY_DIGEST` | `true` | Send a quiet-month summary on `MONTHLY_DIGEST_DAY` |
| `MONTHLY_DIGEST_DAY` | `1` | Day of the month (1–31) the digest lands on, in the container's timezone |
| `FORCE_NOTIFY` | `false` | Send the message even when the threshold was not reached |

Read from the environment, or from a `.env` file when one is present — see
[.env.example](.env.example).

### Getting the token and chat id

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Send your new bot any message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[0].message.chat.id` — that is your chat id.

The token is treated as a secret: it is never written to the logs, so a leaked
log line can't be replayed.

### The monthly digest

Most months the answer is "no, it hasn't dropped", and a job that only speaks up
on bad news is indistinguishable from a job that has quietly died. So once a
month — on the 1st by default — a check that finds nothing still messages you:

```
🗓 Monthly digest — TQQQ (ProShares UltraPro QQQ)

No alert. 15.7% below its 6-month high, and the threshold is 25%.

Now:       74.26 USD (2026-08-10)
Month:     -2.39%
High:      88.09 USD on 2026-06-03
Alert at:  66.07 USD, another 9.3% down
Window:    2026-02-10 → 2026-08-10
```

`Month` is the move since the same date a month ago, and `Alert at` is the price
that would fire the alert — so the digest doubles as a standing answer to "how
far off is it?".

You get at most one message per run. A real alert replaces the digest rather
than arriving alongside it, and `FORCE_NOTIFY` outranks both, so a delivery test
can never be mistaken for the monthly report.

Move it with `MONTHLY_DIGEST_DAY=15`, or turn it off with `MONTHLY_DIGEST=false`.
A day the month is too short for means that month's last day, so
`MONTHLY_DIGEST_DAY=31` reads as "end of month" and still fires in February. The
day starts in the container's timezone, which is UTC unless you set `TZ`:

```bash
docker run --rm --env-file .env -e TZ=Europe/Amsterdam -e MONTHLY_DIGEST_DAY=31 stock-drop-alert
```

### Checking that Telegram actually works

`FORCE_NOTIFY=true` runs the normal check but sends the message whatever the
outcome, so you can confirm the bot reaches you without waiting for a real crash:

```bash
docker run --rm --env-file .env -e FORCE_NOTIFY=true stock-drop-alert
```

The message says so itself, so a test can never be mistaken for the real thing:

```
🧪 Test message — no alert. TQQQ (ProShares UltraPro QQQ) is 15.7% below its
6-month high, which has not reached the threshold.

Threshold: -25%
High:      88.09 USD on 2026-06-03
Now:       74.26 USD (2026-08-10)
Window:    2026-02-10 → 2026-08-10
```

Leave it off in normal operation — it messages you on every single run.

### Stateless, so it repeats itself

There is nothing remembering that it already told you. Every run that finds the
symbol below the threshold sends a message — fine on a daily schedule, chatty on
an hourly one.

The digest counts days, not messages, for the same reason: it fires on every run
that happens to fall on its day of the month. Run the check once a day and that
is one digest a month, as intended; run it hourly and the 1st brings 24 of them.
