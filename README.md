# Market Price Bot 📈

A tiny, **serverless Telegram bot** that publishes **live foreign‑exchange, gold, and tether prices** to a Telegram channel — automatically, every 15 minutes, with a clean right‑to‑left (Persian) layout. It runs entirely on **Cloudflare Workers**, so there is no server to maintain and the running cost is effectively zero.

![Architecture & Data Flow](docs/architecture.png)

---

## What it does

Every 15 minutes the bot wakes up, fetches the latest prices from a public data source, compares each price to **last night's 23:00 baseline**, formats a tidy message, and posts it to the channel:

```
📊 نرخ لحظه‌ای بازار
🕐 ۱۴۰۵/۰۳/۱۳ - ۱۵:۰۸
━━━━━━━━━━━━━━━
🔴 🇺🇸 دلار: ۱۷۳,۹۹۰  (-۴۳۵)
🟢 🇬🇧 پوند: ۲۳۳,۷۳۰  (+۳۵۱)
⚪️ 🥇 انس طلا: $۴,۴۵۰
🔴 🥇 طلای ۱۸ عیار: ۱۸,۳۰۷,۶۰۰  (-۴۵,۷۶۹)
━━━━━━━━━━━━━━━
```

* A coloured ball shows direction at a glance: 🟢 up, 🔴 down, ⚪️ no change / no baseline yet.
* The number in parentheses is the **absolute change in toman** versus last night at 23:00 (USD for the gold ounce).

Once a day, at **23:00 Tehran time**, it sends an **end‑of‑day summary** (with each item's daily low/high) and stores that snapshot as the next day's baseline.

---

## Features

* ⏱ **Scheduled** — runs on a Cron trigger (`*/15 * * * *`), live updates from 08:00 to 22:45, nightly summary at 23:00 (Tehran time).
* 🧮 **Smart change tracking** — compares every price to the 23:00 baseline persisted in Cloudflare KV.
* 🛡 **Never posts garbage** — if the data source returns nothing valid, the bot **skips** the cycle instead of posting an empty/broken message, and never corrupts the baseline.
* 🔔 **Self‑monitoring** — on a source outage it sends the admin a private alert **once**, and a recovery notice when the source comes back (no spam).
* 🔕 **Considerate notifications** — periodic updates are silent; only the nightly summary makes a sound.
* 🌍 **Correct RTL rendering** — uses Unicode bidi isolates so Persian text, numbers, and signs never get scrambled.
* 💸 **Zero‑maintenance & near‑zero cost** — pure Cloudflare Workers + KV, no server, no database to run.

---

## How it works

The whole program lives in [`worker.js`](worker.js). On each Cron tick, `handleSchedule()` runs this pipeline:

1. **Fetch & validate** — `fetchAllPrices()` calls the data API and returns `{ ok, validCount, prices }`. If `ok` is `false` (network error, bad JSON, or no valid items), nothing is sent.
2. **Normalize** — currencies are quoted in rial and divided by 10 to get toman; the gold ounce (`ons`) is already in USD and shown with a `$`.
3. **Compare** — each price is diffed against the `last_night` baseline read from KV to pick the ball colour and the change amount.
4. **Format** — `buildMessage()` / `buildAnalysis()` produce a right‑to‑left HTML message (bold prices, numeric Jalali date, clock).
5. **Route** — at 23:00 it sends the summary and saves tomorrow's baseline (once per day); during working hours it sends a live update (silent); otherwise it stays quiet.
6. **Health** — `updateHealth()` flips an `api_down` flag in KV and notifies the admin on outage/recovery.

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | **Cloudflare Workers** | Serverless, built‑in Cron & KV, global, ~zero cost |
| Language | **JavaScript** | Native to Workers; strong `Intl` for Tehran time & Jalali date |
| Data source | **tgju.org** `ajax.json` | Free, complete, machine‑readable JSON (incl. daily high/low) |
| Delivery | **Telegram Bot API** | Official, simple, secure (`sendMessage`, HTML parse mode) |
| State | **Cloudflare KV** | Simple key–value store for the baseline & flags, with TTL |

---

## Project structure

```
.
├── worker.js                 # the entire bot (single file)
├── wrangler.toml             # Cloudflare config (cron, KV binding)
├── README.md
└── docs/
    ├── architecture.svg      # editable architecture diagram (source)
    └── architecture.png      # rendered diagram (used in this README)
```

---

## Setup & deployment

### Prerequisites

* A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free plan is enough).
* [Node.js](https://nodejs.org/) and the Wrangler CLI: `npm install -g wrangler`.
* A Telegram bot token from [@BotFather](https://t.me/BotFather), and the bot added as an **admin** to your channel.

### 1. Clone & install

```bash
git clone https://github.com/<your-username>/market-price-bot.git
cd market-price-bot
wrangler login
```

### 2. Create the KV namespace

```bash
wrangler kv namespace create PRICE_STORE
```

Copy the returned `id` into `wrangler.toml`:

```toml
name = "dollar-bot"
main = "worker.js"
compatibility_date = "2024-01-01"

[triggers]
crons = ["*/15 * * * *"]

[[kv_namespaces]]
binding = "PRICE_STORE"
id = "<your-kv-namespace-id>"
```

### 3. Add secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN     # e.g. 123456:ABC-DEF...
wrangler secret put TELEGRAM_CHANNEL_ID    # e.g. @your_channel  or  -1001234567890
```

### 4. Deploy

```bash
wrangler deploy
```

That's it — the Cron trigger will start firing every 15 minutes.

---

## Configuration

All configuration lives at the top of [`worker.js`](worker.js):

* **`ITEMS`** — the list of instruments to display. Each entry has a `key` (the field in the source JSON), an `icon`, a `name`, and an optional `usd: true` (for items priced in USD, like the gold ounce, which skips the ÷10 rial→toman conversion).
* **`ADMIN_CHAT_ID`** — the numeric chat ID that receives private health alerts. ⚠️ The admin **must press *Start* on the bot once**, otherwise Telegram blocks the bot from messaging them (error 403).
* **Working hours** — `isWorkingHours()` (08:00–22:59) and the `hour === 23` branch in `handleSchedule()`.
* **Notifications** — the `silent` flag passed to `sendToTelegram()` (live = silent, summary = sound).

---

## HTTP endpoints (for testing)

The Worker also answers a few routes via `fetch()` so you can test without waiting for the cron:

| Route | Effect |
|-------|--------|
| `/preview` | Returns the live message as plain text — **does not send** to Telegram |
| `/trigger` | Forces a live message to be sent now (bypasses working‑hours check) |
| `/analysis` | Forces the end‑of‑day summary to be sent now |

---

## Data source notes

* The source returns prices as **comma‑separated strings** (e.g. `"1,740,100"`).
* Currency keys (`price_dollar_rl`, `price_eur`, …) are in **rial** → divided by 10 for **toman**.
* `ons` (gold ounce) is in **USD** → shown as‑is with a `$`.
* `price_jpy` is quoted per **100 yen** by the source (shown as provided — not a bug).
* The endpoint is unofficial; if its structure ever changes, the affected items simply stop showing (and the admin gets an alert), so failures are visible rather than silent.

---

## Reliability & design notes

* **Fail silently, not loudly** — the guiding principle: when data is suspect, skip rather than publish something wrong.
* **Baseline integrity** — only valid (`> 0`) prices are written to the `last_night` snapshot, so a missing item never poisons tomorrow's comparison.
* **Idempotent summary** — a per‑day KV key (`analysis_sent_<date>`, with TTL) ensures the nightly summary is sent exactly once; the flag is set **only on success**, so a failed 23:00 tick is retried on the next tick within that hour.
* **Bidi correctness** — every line starts with an RLM and numbers are wrapped in `LRI … PDI` isolates so signs and digits render correctly inside RTL text.

---

## Limitations

* Full column alignment of every field isn't achievable in Telegram with Persian proportional fonts + emoji, so the layout aligns by leading the line with the coloured ball rather than using a monospace table.
* Depends on an unofficial data endpoint.

## Possible improvements

* Skip publishing when no price changed since the last post.
* Skip market holidays (e.g. Fridays).
* Add unit tests for the formatting/diff helpers.
* Add observability (structured logs, a health dashboard).

---

## License

MIT — feel free to use, modify, and share.
# TelegramBot-CurrencyRate
