# PRIME TECHNICAL LIVE SCANNER — Deployment Guide

5-minute intraday PDH/PDL scanner for the NIFTY 500 universe, powered by the
Upstox API. Scanner/dashboard only — **no orders are ever placed**.

> A full step-by-step guide (Hindi + English) is also available inside the app
> at **`/guide`**.

## Architecture

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS v4**
- **PostgreSQL (Drizzle ORM)** — scan runs, per-day symbol snapshots, signal
  event log, instrument-key cache. Results persist for the full trading day.
- **Server-only Upstox calls** — `UPSTOX_ACCESS_TOKEN` is read from environment
  variables and never reaches the browser.

### Modules

| File | Responsibility |
| --- | --- |
| `src/lib/upstox.ts` | Upstox client: auth headers, timeouts, 429/5xx retries, v3/v2 intraday + daily candles, instrument-key resolution, LTP batch |
| `src/lib/marketData.ts` | Completed-candle filtering, per-symbol fault isolation, PDH/PDL + warmup cache |
| `src/lib/levels.ts`… see `marketData`/`prime` | PDH/PDL strictly from the previous completed daily candle |
| `src/lib/indicators.ts` | 20 EMA series + slope (no look-ahead) |
| `src/lib/volume.ts` | Rolling 5-min volume reference + multiple classification |
| `src/lib/prime.ts` | The Prime Technical state machine: WATCH → SETUP → CONFIRMED |
| `src/lib/scanner.ts` | Orchestration, persistence, escalation preservation, payload assembly |
| `src/lib/simulate.ts` | Deterministic simulation (only when no token configured) |

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `UPSTOX_ACCESS_TOKEN` | Live mode | Upstox API token (daily expiry per Upstox policy) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SCAN_START` | No (default `09:15`) | Live scan window start (IST) |
| `SCAN_END` | No (default `10:00`) | Live scan window end — results lock afterwards |
| `BREAKOUT_VOL_MIN` | No (default `1.5`) | Min volume multiple on trigger candle |
| `VOLUME_REF_CANDLES` | No (default `20`) | Rolling reference candle count |
| `RISK_REWARD` | No (default `2`) | Target multiple (display only) |
| `RESCAN_SECONDS` | No (default `45`) | Min gap between scans |
| `NEAR_LEVEL_PCT` | No (default `0.75`) | "Approaching level" distance |
| `RETEST_PCT` | No (default `0.35`) | Continuation retest tolerance |
| `SL_BUFFER_PCT` | No (default `0.15`) | Stop-loss buffer below structure |
| `EMA_PERIOD` | No (default `20`) | EMA period (5-min timeframe) |

## Local development

```bash
npm install
cp .env.example .env   # fill DATABASE_URL (+ UPSTOX_ACCESS_TOKEN for live)
npx drizzle-kit push   # create tables
npm run dev
```

Open http://localhost:3000 — without a token the app runs in clearly-labeled
SIMULATION MODE so every engine path is exercisable.

## Vercel (permanent link)

1. Push this repo to GitHub.
2. Vercel → Add New → Project → import the repo → Deploy.
3. Vercel → Storage → Create Database → Postgres (sets `DATABASE_URL`).
4. Settings → Environment Variables → add `UPSTOX_ACCESS_TOKEN`.
5. Redeploy. Open the `*.vercel.app` URL at 09:15 IST.

The dashboard polls `/api/scan` every ~45 s; a fresh scan runs only inside the
live window, and only when due. Between polls the last persisted snapshot is
served from Postgres — a failed scan never blanks the board.
