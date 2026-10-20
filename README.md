# Meme Guard

A risk-reduced, non-custodial Solana meme coin app. It blocks avoidable losses (rugs, honeypots, bundled supply) and enforces discipline. It does not promise profit, and no check removes all risk. Meme coins can go to zero.

The full build spec lives in [docs/SPEC.md](docs/SPEC.md). Work follows it one phase at a time.

## Layout

```
apps/web              Next.js: UI plus API route handlers
apps/worker           Node/TypeScript: scanner, risk reports, outcome tracker, regime, notifications
packages/core         risk engine config (filters and scoring arrive in Phase 2)
packages/providers    one module per external API
packages/db           Drizzle schema, migrations, client
packages/trading      paper, live, limits
packages/shared-types zod schemas and types shared by web and worker
```

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

Postgres and Redis start, migrations run against the database, then the worker and web app start.
Open http://localhost:3000. The home page shows worker health.

## Run locally

Requires Node 20.9+ and pnpm 10.

```bash
cp .env.example .env
pnpm install
docker compose up postgres redis -d
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:3000
- Worker health: http://localhost:4000/health

`pnpm dev`, `pnpm db:migrate` and `pnpm db:generate` load the root `.env` (via `dotenv-cli`) before running, so one file configures both apps. Stop the Docker `web` and `worker` containers first if they are running, or the ports will collide.

## Explore (Phase 1)

The worker scans DexScreener listing endpoints every `SCAN_INTERVAL_MS` (default 20 s), refreshes every coin seen in the last `TRACK_WINDOW_HOURS`, and stores snapshots for `SNAPSHOT_RETENTION_DAYS`. Open http://localhost:3000/explore to search by name, ticker or contract address, filter, sort, and open a coin for candles, holders and snapshots.

Data sources and what happens when one is missing:

| Data | Source | Without it |
| --- | --- | --- |
| Listings, price, liquidity, volume | DexScreener (no key) | Scanner keeps running, `lastError` in `/health` names the source, list keeps last good data |
| Candles | Birdeye if `BIRDEYE_API_KEY` is set, else GeckoTerminal (no key) | Chart shows "unavailable" with the reason |
| Holders, supply, mint and freeze authority | Birdeye for holders if configured, else Helius (`HELIUS_API_KEY`) | Panels show "not configured"; fields stay unknown, never zero |

Every coin shows `UNVERIFIED` until Phase 2 adds risk reports. Unverified and blocked coins are never tradable.
