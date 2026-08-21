# yawm

A tiny Telegram bot that posts a daily "how much of the year is gone" progress bar to a channel.

Every morning it works out what day of the year it is, renders that as a four-line bar of
block characters, and posts it to your channel along with the date, the number of days left
in the year, and the percentage complete. That's the whole product. One file, three
dependencies.

A posted message looks roughly like this:

```
📅 November 24, 2025

███████████████████████████████████████████████
███████████████████████████████████████████████
███████████████████████████████████████████████
██████████████████████████░░░░░░░░░░░░░░░░░░░░░

✨ Days until 2026: 37
📊 Progress: 328/365 days (89.9%)
```

## Features

- Daily automatic post to a Telegram channel at 07:00, driven by `node-cron`.
- Four-line progress bar built from `█` / `░`, wrapped in a Markdown code block so it stays
  aligned in every Telegram client.
- Leap-year aware — the bar is sized to 366 days in a leap year, 365 otherwise.
- Chat commands to trigger, preview and inspect the countdown on demand:

  | Command | What it does |
  | --- | --- |
  | `/update` | Posts the countdown to the channel immediately |
  | `/reset` | Clears the stored `messageId` and posts a fresh message |
  | `/status` | Replies with days passed, days remaining and percentage (no channel post) |
  | `/test` | Replies with a preview of the countdown (no channel post, nothing saved) |
  | `/sendcountdown` | Test mode: advances a simulated day counter by one and edits the test message in the channel |
  | `/resettestcount` | Resets the simulated day counter back to today |

- Simple JSON file (`countdown.json`) as the state store — no database.

## Tech stack

- [TypeScript](https://www.typescriptlang.org/) (ESM — `"type": "module"`)
- [grammY](https://grammy.dev/) — Telegram Bot API client
- [node-cron](https://www.npmjs.com/package/node-cron) — scheduling
- [dotenv](https://www.npmjs.com/package/dotenv) — env loading
- Node.js

## How it works

All of the logic lives in [`bot.ts`](./bot.ts).

**Startup.** `dotenv.config()` loads `.env`, then `BOT_TOKEN` and `CHANNEL_ID` are read from
the environment (`CHANNEL_ID` is coerced with `Number()`, so it must be the numeric form, not
an `@username`). A grammY `Bot` is constructed, `countdown.json` is read into memory if it
exists, and `bot.start()` opens a long-polling connection.

**Working out the day.** `getDaysUntilNewYear()` takes today at local midnight, subtracts
January 1st of the same year, and floors the difference into whole days, then adds one so that
January 1st is day 1. It computes the year length with a standard leap-year test and returns
`{ daysPassed, totalDays }`. It also prints a handful of `DEBUG:` lines to stdout on every call.

**Rendering the bar.** `generateCountdown(daysPassed, totalDays)` splits the year across four
lines of `ceil(totalDays / 4)` characters each, filling `daysPassed` cells with `█` and the rest
with `░`, spilling from one line to the next. The four lines are wrapped in a fenced code block
so Telegram renders them monospaced and the columns line up. The date header comes from
`toLocaleDateString("en-US", …)`, and the footer adds the remaining-day count and the
percentage.

**Posting.** `updateCountdown()` builds the message, calls `sendMessage(channelId, …)` with
`parse_mode: "Markdown"`, stores the returned `message_id` under `messageId` in
`countdown.json`, and logs the result. Errors are caught and logged rather than thrown — a
failed post will not take the process down.

**Scheduling.** `cron.schedule("0 7 * * *", …)` fires `updateCountdown()` once a day at 07:00.
The cron expression is hardcoded; there is no timezone argument, so it follows the local
timezone of whatever machine the bot runs on.

**Test mode.** `/sendcountdown` exists to fast-forward the animation without waiting a day. It
keeps a separate simulated counter in `testCount`, bumps it by one per call, and *edits* the
message recorded in `testMessageId` instead of posting a new one. If the edit fails (message
deleted, too old, unchanged text) it falls back to sending a new message and records that ID.
`/resettestcount` snaps `testCount` back to the real current day and forgets `testMessageId`.

**`countdown.json`** is therefore just the bot's runtime scratch state, rewritten with
`fs.writeFileSync` after most operations:

| Key | Meaning |
| --- | --- |
| `messageId` | ID of the last countdown message posted by `/update` or the cron job |
| `testCount` | Simulated day counter used only by `/sendcountdown` |
| `testMessageId` | ID of the message `/sendcountdown` edits in place |

The path is relative (`./countdown.json`), so the bot must be started from the repository
root. The file is created on first write; you do not need to seed it. Any `countdown.json`
committed to the repo is stale state from someone else's channel and can safely be deleted.

## Prerequisites

- Node.js 18 or newer (ESM + modern `fetch` used by grammY).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- A Telegram channel where the bot has been added **as an administrator with permission to
  post messages** — test mode additionally needs permission to edit its own messages.
- The channel's numeric ID (see below).

### Getting the channel ID

Channel IDs are negative numbers beginning with `-100`. The easiest way to find yours is to
forward any message from the channel to a bot such as `@userinfobot`, or to call
`https://api.telegram.org/bot<TOKEN>/getUpdates` after posting in the channel and read
`chat.id` from the response.

## Setup & installation

```bash
git clone https://github.com/dostonsulaymon/yawm.git
cd yawm
npm install
cp .env.example .env
# then edit .env and fill in your real values
```

> `.env` is already covered by `.gitignore` — keep it that way and never commit real
> credentials.

## Configuration

Both variables are read in `bot.ts` via `process.env` after `dotenv.config()`. There are no
others.

| Variable | Required | Type | Description |
| --- | --- | --- | --- |
| `BOT_TOKEN` | yes | string | Bot token from @BotFather. Passed straight to grammY; the bot will fail to start without it. |
| `CHANNEL_ID` | yes | number | Numeric ID of the target channel, e.g. `-1001234567890`. Parsed with `Number()`, so usernames like `@mychannel` will not work. |
| `ADMIN_IDS` | yes | string | Comma-separated Telegram user IDs allowed to run commands, e.g. `111111111,222222222`. Get yours from @userinfobot. **If unset or empty, every command is refused** — the bot fails closed rather than letting strangers post to your channel. The scheduled 07:00 post is unaffected. |

Everything else — the 07:00 schedule, the four-line layout, the `en-US` date format, the state
file path — is currently hardcoded in `bot.ts`.

## Running it

`package.json` ships **no start script** (only the default `test` placeholder, which just
exits with an error). Since `bot.ts` is TypeScript ESM, run it through a TS-aware loader:

```bash
npx tsx bot.ts
```

Add `tsx` as a dev dependency and wire up a script if you're running this regularly:

```bash
npm install -D tsx
```

```jsonc
// package.json
"scripts": {
  "start": "tsx bot.ts",
  "dev": "tsx watch bot.ts"
}
```

On start you should see `✅ Bot started successfully!` followed by the command list. Send
`/status` to the bot in a direct message to confirm it is alive, and `/test` to preview the
bar before letting it loose on the channel.

Note that `tsconfig.json` is the stock scaffold with `"types": []` and no Node `lib`, so a
plain `tsc` type-check will not resolve `process`, `fs` or the other Node globals. If you want
type-checking to pass, set `"types": ["node"]` and `"lib": ["esnext"]` — the file's own
comments point at this. Running via `tsx` is unaffected, as it strips types rather than
checking them.

## Deployment

The bot is a single long-running process using long polling, so anything that keeps a Node
process alive works — a VPS with systemd or pm2, a small container, a Raspberry Pi. A few
things the code implies:

- **Run exactly one instance.** `bot.start()` uses long polling; two instances against the
  same token will fight over updates.
- **Set the timezone.** The cron expression has no timezone, so "07:00" means 07:00 on the
  host. Set `TZ` on the process (or the machine) to the timezone you actually want.
- **Start from the repo root and keep the directory writable.** `countdown.json` is written
  with a relative path; in a container, mount it on a volume or the message IDs are lost on
  every restart.
- **Serverless/cron platforms are a poor fit** as written — the process must stay up for both
  the scheduler and the command handlers.

## Known limitations

Small project, honest list:

- The "Days until **2026**" label in `generateCountdown()` is a hardcoded string, not
  `currentYear + 1`. It will need updating each year.
- `updateCountdown()` always sends a *new* message even though it saves `messageId`; only the
  `/sendcountdown` test path edits in place.
- `getDaysUntilNewYear()` returns the day of the year, not days until New Year, despite the
  name.

## Contributing

Issues and pull requests are welcome. It's one file — keep changes small and focused, match
the existing style, and describe what you changed and why. If you're adding configuration,
prefer an environment variable with a sensible default over a new hardcoded constant, and
update the table above and `.env.example` to match. Never commit a real bot token, channel ID
or `.env` file.

## License

Released under the [MIT License](./LICENSE).
