# Meme Guard: Build Spec for Cursor (Phased)

Working name: Meme Guard. Prepared October 3, 2026. A risk-reduced meme coin trading app, built as a Next.js app (UI and API) plus a separate TypeScript worker for scanning and risk checks.

## 1. Product rules (non-negotiable)

Give these to Cursor first. Every feature must respect them.

1. The app never promises profit or "no loss". It blocks avoidable losses (rugs, honeypots, bundled supply) and enforces discipline (sizing, stops, cooldowns). Marketing and UI copy say "risk-reduced", never "safe" or "guaranteed".
2. Non-custodial. The app never holds user funds, seed phrases or private keys. Users connect their own wallet (Phantom/Solflare) and sign every transaction.
3. Every verdict is explainable. Each coin shows PASS/BLOCKED plus the exact reasons and raw numbers behind them.
4. Data-driven thresholds. Starting thresholds come from the meme coin guide you shared, but they are config values, calibrated later against outcome data. Never hardcode them in logic.
5. Fail closed. If a data source is down or a field is missing, the coin is "UNVERIFIED" and cannot be traded.
6. Paper trading before live trading. Live execution ships last, behind a feature flag and small limits.
7. No copy-trading. Followed wallets can be used for discovery signals only.

## 2. Architecture and stack

This is a standalone product: its own repository, database, scanner and risk engine, with no runtime link to the Degen Guard bot and no dependency on Telegram. Degen Guard is a reference only. Cursor may borrow ideas or code from it (DexScreener scanning, RugCheck scoring, creator history, outcome tracking), but nothing is shared or imported. Users interact only through the web app, and alerts are delivered inside it.

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | Next.js (App Router), TypeScript, TailwindCSS | Your core stack |
| Charts | TradingView Lightweight Charts, or Chart.js | Lightweight Charts is better for candles |
| Backend | Next.js route handlers and server actions (TypeScript) | API for the web app; long-running work lives in the worker |
| Database | PostgreSQL | Drizzle ORM and migrations (Prisma also works) |
| Cache and queue | Redis with BullMQ | Needed once scanning and API fan-out grow |
| Realtime | Server-Sent Events from a route handler, or WebSocket from the worker | Live prices and verdict changes |
| Wallet | Solana wallet-adapter (Phantom, Solflare) | Non-custodial |
| Execution | Jupiter Swap API, optional Jito bundles | Phase 5 only |
| Auth | Wallet sign-in (SIWS) plus session cookie | No passwords |
| Hosting | Web app and worker together on one VPS or Railway/Render via Docker | Pick one and keep it simple. If the web app goes on Vercel, the worker still needs a long-running host |
| Alerts | In-app notification center (SSE or WebSocket), web push, optional email | Per-user alert settings |
| Worker | Standalone TypeScript (Node) process in apps/worker | Scanner, risk reports, outcome tracker, regime, notifications; shares packages with the web app |

Start with Solana only. Add EVM chains after the Solana engine is proven (you already evaluated GoPlus for EVM and found sparse coverage on some chains, so test coverage before committing to any new chain).

## 3. Repository layout

```
meme-guard/
  apps/
    web/                 # Next.js: UI plus API route handlers
      src/app/api/       # tokens, trade, portfolio, journal, notifications
    worker/              # Node/TypeScript: scanner, risk reports, outcome tracker, regime, notifications
  packages/
    core/                # risk engine: filters.ts, scoring.ts, risk-config.json
    providers/           # one module per external API (see section 5)
    db/                  # Drizzle schema, migrations, client
    trading/             # paper.ts, live.ts, limits.ts
    shared-types/        # zod schemas and types used by web and worker
  docker-compose.yml
  .cursor/rules/         # Cursor rules (section 9)
  docs/                  # this spec, API notes, threshold calibration notes
```

## 4. Data model (PostgreSQL)

Cursor should create these tables with Drizzle migrations in the new app's own database.

| Table | Key columns |
| --- | --- |
| tokens | mint (pk), symbol, name, chain, created_at, creator_wallet, launchpad, first_seen_at |
| token_snapshots | id, mint, ts, price, market_cap, liquidity_usd, volume_5m/1h/24h, holders, top1_pct, top5_pct, top10_pct, fees_paid_sol |
| risk_reports | id, mint, ts, verdict (PASS/BLOCKED/UNVERIFIED), score (0-100), hard_fail_reasons (jsonb), score_breakdown (jsonb), raw_sources (jsonb), config_version |
| wallet_links | mint, wallet, cluster_id, funding_source, wallet_age_days, is_fresh, is_bundler_flag |
| creators | wallet, tokens_launched, tokens_rugged, last_checked |
| users | id, wallet_address, created_at, settings (jsonb) |
| positions | id, user_id, mint, mode (paper/live), entry_price, size_sol, status, thesis, exit_plan (jsonb), opened_at, closed_at |
| trades | id, position_id, side, price, amount, slippage_pct, tx_signature (live only), ts |
| journal_entries | id, user_id, position_id, thesis, outcome_notes, mistake_tag, created_at |
| limit_events | id, user_id, type (daily_loss, cooldown, size_cap), ts, detail |
| notifications / alert_outcomes | notifications: user_id, type, payload, read_at, created_at; alert_outcomes: price and market cap at 5m/15m/30m/1h/6h/24h after each alert and each scanned coin |
| regime_snapshots | ts, btc_trend, sol_trend, memecoin_volume_index, avg_peak_mcap, regime (HOT/NEUTRAL/COLD) |

## 5. External services (build one provider module each)

Each provider module exposes a small typed interface, caches responses in Redis, handles rate limits and timeouts, and returns "unavailable" instead of raising. Cursor must read each provider's current documentation before coding against it, because endpoints, pricing and rate limits change.

| Purpose | Service | Used for |
| --- | --- | --- |
| Discovery and market data | DexScreener API | New pairs, profiles, boosts, price, liquidity, volume, pair info |
| More market data | Birdeye or GeckoTerminal | Holders list, OHLCV candles, trending |
| Contract safety (Solana) | RugCheck API | Mint/freeze authority, LP lock %, holder concentration, risk flags |
| On-chain data | Helius (RPC, DAS, parsed transactions, webhooks) | Wallet age, funding source, dev buys/sells, holder wallets |
| Cluster detection | Bubblemaps (check for an API or partner access) or your own funding-graph logic | Linked-wallet clusters |
| Swap quotes and execution | Jupiter Swap API | Quotes, price impact, sell simulation, swaps |
| Launchpad data | Pump.fun / PumpPortal (verify availability) | Bonding curve progress, creator, early trades |
| Social | X API (costly) or a third-party social metrics provider | Mention velocity, community checks (Phase 4+) |
| EVM safety (later) | GoPlus Security, Honeypot.is | Only after testing coverage per chain |

If the Bubblemaps API is not available to you, build your own cluster heuristic from Helius data: group top holders that share a funding source, were created within a short window, or have transferred between each other.

## 6. Risk engine specification

This is the core product. Keep all values in `packages/core/risk-config.json` with a `config_version` stored on every report. Starting numbers are informed by a public educational memecoin guide (volume versus market cap, holder concentration, fresh wallets, chart patterns). That guide is not reproduced here and is not financial advice.

### 6.1 Hard filters (any failure = BLOCKED, cannot be traded)

| Rule | Starting threshold | Source |
| --- | --- | --- |
| Mint authority not revoked | must be revoked | RugCheck / Helius |
| Freeze authority not revoked | must be revoked | RugCheck / Helius |
| Liquidity not locked or burned | locked/burned % at least 90 (exempt: coins still on a launchpad bonding curve, which handle this) | RugCheck |
| Sell simulation fails | simulated sell via Jupiter must return a valid quote with acceptable impact | Jupiter |
| Largest non-LP holder too big | above 3.5% of supply (config) | RugCheck / Birdeye |
| Fresh-wallet holders | more than 3 fresh wallets among top 20 | Helius |
| Same-source funded wallets | more than 3 top holders funded from one source | Helius |
| Bundled share | cluster controls more than 20% of supply (config) | Bubblemaps or own clusters |
| Creator has rugged before | 1 or more prior rugs | creators table |
| Honeypot pattern | up-only chart plus low volume plus few holders | combined check |
| Minimum liquidity | config (start at 5 SOL equivalent) | DexScreener |
| Volume vs market cap | 24h volume / mcap below 1.0 when the pair is younger than `young_hours` (start 6), below 0.8 otherwise. Missing volume or mcap is UNVERIFIED | DexScreener |
| Recent prints | both 5m and 1h volume below config floors (start $100 / $500) is BLOCKED; either window at the floor passes; both missing is UNVERIFIED | DexScreener |

### 6.2 Scoring layer (0 to 100, only for coins that pass hard filters)

Each factor returns 0 to 1 and is multiplied by a weight. Weights live in config. Starting weights:

| Factor | Weight | Logic |
| --- | --- | --- |
| Liquidity depth vs market cap | 20 | Higher liquidity ratio is better |
| Volume vs market cap | 15 | Only scored after the hard floor. Younger coins still want a larger surplus (same 1.0 / 0.8 starting ratios) |
| Fees paid vs market cap | 10 | Disabled until a real fee-paid source exists. Guide example for later calibration: about 0.5 SOL of fees on a $15k cap. Do not invent fees from volume |
| Holder distribution | 20 | Top 5 and top 10 concentration, holder growth |
| Dev behavior | 10 | Large dev buy or dev sells moving the market cap are penalized |
| Chart authenticity | 15 | Detect near-identical candles, single huge candles, staircase pattern |
| Narrative crowding | 10 | Other coins with the same name or symbol in the config window lower the score. This says the story is crowded. It does not say the story is good. Unknown name and symbol is UNVERIFIED |
| Social legitimacy | 0 | Mention velocity and bot-like posts, once an X API key exists. Weight stays 0 until those rules are turned on, so a missing key does not block trading. This is whether attention looks real, not whether the narrative is strong |

Score bands: 75+ = LOWER RISK, 50 to 74 = MEDIUM, below 50 = HIGH (tradable only with a warning and a smaller size cap). Never label anything "safe".

### 6.3 Output shape

Every report returns: verdict, score, a list of reasons (each with rule name, value, threshold, pass/fail), data freshness timestamp, and which sources were unavailable.

### 6.4 Calibration

The outcome tracker records each scanned coin's result at 5m, 15m, 30m, 1h, 6h and 24h. A weekly job reports, per rule, how often BLOCKED coins rugged versus PASS coins, so thresholds can be tuned from evidence rather than opinion.

## 7. Phases

Each phase has tasks, deliverables and acceptance criteria. Do not start a phase until the previous one's criteria pass.

### Phase 0: Foundation (about 2 to 3 days)

Tasks

- Create the monorepo from section 3 (pnpm workspaces with Turborepo), with the Next.js app in `apps/web` and the TypeScript worker in `apps/worker`.
- Add Drizzle migrations, a typed settings module that validates environment variables with zod, structured logging, and a `/health` endpoint.
- Docker Compose with Postgres and Redis. A `.env.example` listing every key (Helius, Birdeye, RugCheck if needed).
- Next.js app with Tailwind, a layout shell (nav: Explore, Trade, Portfolio, Journal, Settings), and a typed API client.
- Put zod schemas and TypeScript types shared by the web app and the worker in `packages/shared-types`.
- Add the Cursor rules from section 9.

Acceptance: `docker compose up` starts everything; the web app loads and shows worker health; migrations run cleanly on an empty database.

### Phase 1: Explore (all coins) (about 1 week)

Tasks

- Provider modules for DexScreener, Birdeye or GeckoTerminal, and Helius with caching and rate limiting.
- Scanner worker (new; may borrow logic from Degen Guard): discovery from profiles and boosts, writes `tokens` and `token_snapshots`.
- API: `GET /tokens` (filters: age, market cap range, volume, verdict, sort), `GET /tokens/{mint}` (detail with snapshots).
- Frontend Explore page: table with search by name, ticker or contract address, filters, sort, and live refresh. Token detail page with candle chart, key stats, holders list and links (DexScreener, Solscan).
- A visible badge on every row: PASS / BLOCKED / UNVERIFIED (placeholder "UNVERIFIED" until Phase 2).

Acceptance: Explore shows fresh Solana coins within 30 seconds of discovery; search by contract address works; no provider error crashes a page.

### Phase 2: Risk engine and the Trade section (about 1.5 to 2 weeks)

Tasks

- Implement `packages/core/filters.ts` and `packages/core/scoring.ts` exactly per section 6, driven by `risk-config.json`.
- Add the RugCheck provider and a Jupiter sell-simulation function (quote a sell of a small test amount and check the result and price impact).
- Wallet analysis worker with Helius: wallet age, fresh-wallet flag, funding source, cluster grouping, dev buy/sell detection. If the Helius key is not yet set up, mark those rules UNVERIFIED rather than skipping them.
- Chart authenticity detector from candles (identical-size candles, one-candle spikes, staircase).
- Creator-history check (built fresh against this app's own database).
- API: `GET /tokens/{mint}/risk` and `GET /trade/candidates` (only coins with verdict PASS).
- Frontend Trade page: lists only PASS coins, ranked by score. Each row opens a Risk Card showing every rule with value, threshold and result, plus a plain-language summary. BLOCKED coins are visible in Explore with the reasons but have no trade button.
- Store every report in `risk_reports` with `config_version`.

Acceptance: A known honeypot or rugged token from your alert history is correctly BLOCKED with the right reason; a token with a missing data source shows UNVERIFIED and cannot be traded; unit tests cover every hard filter and boundary value.

### Phase 3: Paper trading and the discipline engine (about 1.5 weeks)

Tasks

- Wallet sign-in (SIWS) and user settings.
- Paper trading: virtual balance, simulated fills at the live quote including estimated slippage and price impact, same code path as live later.
- Discipline engine in `packages/trading/limits.ts`, all values user-editable within safe bounds: maximum percent of portfolio per coin (default 5%), maximum open positions (default 5), maximum percent for a coin under 500K market cap, daily loss limit with trading lock, cooldown after a losing trade, and score-based size caps (HIGH risk = smaller cap).
- Mandatory thesis form before any buy: why I am buying, what would make me sell. The buy button stays disabled until both are filled.
- Exit plan set at entry: stop-loss level, and a scale-out ladder (for example sell portions at 2x, 3x, 5x). The app shows alerts when levels are hit. State clearly in the UI that stops on thin liquidity can slip or fail.
- FOMO check: if the coin is already up a large percentage in the last hour, show a confirmation asking whether the user would still buy at this price with no chart in front of them.
- Re-check prompt: when a position is up substantially, ask whether they would buy it now at this price.
- Portfolio page: open positions, PnL, exposure by coin, and limit status.
- Journal page: auto-created entry per closed position with thesis, result and a mistake tag (oversized, ignored red flag, emotional entry, no exit plan, other).

Acceptance: A user cannot exceed any limit; a daily-loss lock blocks new buys until the next day; a position cannot be opened without a thesis; paper PnL matches a manual calculation in tests.

### Phase 4: Market regime, alerts, outcome calibration (about 1 week)

Tasks

- Regime worker: compute HOT / NEUTRAL / COLD from BTC, ETH and SOL trend (higher highs and lows on daily), memecoin volume trend, and the typical peak market cap of recent launches. Store in `regime_snapshots`.
- Regime banner across the app. In COLD regime, automatically lower size caps and show a warning; the user can still trade within the reduced limits.
- In-app notification center (bell icon, live via SSE or WebSocket), web push and optional email, with per-user settings: new PASS coins above a score, position stop/ladder hits, daily loss limit reached, verdict change on a held coin (a PASS coin turning BLOCKED triggers an urgent alert).
- Calibration report page (admin): per-rule precision, outcomes by score band, config version comparison.
- Social legitimacy module (optional in this phase): bot-post filtering on X, community activity check; if the X API cost is too high, defer it.

Acceptance: Regime changes are reflected within an hour; alerts fire once per event with no duplicates; the calibration report runs against at least a week of real outcome data.

### Phase 5: Live execution (about 1.5 to 2 weeks, behind a feature flag)

Tasks

- Jupiter quote then swap transaction built by the backend, signed in the user's wallet in the browser. The backend never sees a private key.
- Pre-trade checks run again at the moment of trade: fresh risk report (not older than a few seconds), sell simulation, price impact limit, slippage limit, discipline limits.
- Optional: Jito bundle or priority-fee settings to reduce sandwiching; make this a setting with a sane default.
- Show the user an exact summary before signing: amount, expected output, price impact, slippage setting, fees.
- Record every live trade with its transaction signature and confirm it on-chain before updating the position.
- Hard caps for the beta: small maximum trade size, a global kill switch for admins, and a per-user live-trading allowlist.
- Sell flow with the same checks; a one-click "exit all" that respects slippage limits.

Acceptance: Live trades work end to end on mainnet with tiny amounts; a trade is refused if the verdict flipped to BLOCKED during review; the kill switch stops all new live trades.

### Phase 6: Hardening and launch (about 1 to 2 weeks)

Tasks

- Security review: rate limiting, input validation, CORS, secrets management, dependency audit, and a phishing defense (clear official-domain display, no links in notifications that go to wallet-connect pages).
- Observability: error tracking (Sentry), uptime checks, provider failure dashboards, cost tracking per API.
- Load test the scanner and API against provider rate limits; add backoff and circuit breakers.
- Legal and compliance review for Nigeria and any other target market (see section 8) before opening to the public.
- Onboarding flow that teaches the key rules (what BLOCKED means, why limits exist, what a stop-loss can and cannot do).
- Closed beta with a small group, then iterate on calibration data.

Acceptance: Penetration checklist passed, legal sign-off obtained, beta users complete a paper-to-live path without support.

## 8. Security and legal checklist

- Never request, store or log seed phrases or private keys. The wallet signs everything.
- Sign-in uses a signed message (SIWS); sessions use secure, httpOnly cookies.
- Store API keys in environment variables or a secret manager, never in the repo.
- Show a persistent risk disclosure: meme coins can go to zero and no check removes all risk.
- Avoid income claims and testimonials implying guaranteed returns in all marketing.
- Consult a Nigerian lawyer on how SEC Nigeria's digital asset rules apply to a trading interface, and check the rules in any other country you target.
- Respect each data provider's terms of service on redistribution and commercial use.

## 9. Cursor setup

Create `.cursor/rules/project.mdc` with the following content:

```
Project: Meme Guard. Non-custodial, risk-reduced Solana meme coin app.
Stack: TypeScript everywhere. Next.js App Router (UI and API route handlers),
a separate Node worker for scanning and risk checks, PostgreSQL with Drizzle,
Redis with BullMQ, Tailwind.
Rules:
- Never handle private keys or seed phrases. Wallet signing happens in the
  browser only.
- All risk thresholds and weights come from packages/core/risk-config.json,
  never hardcoded.
- Fail closed: missing or failed data means UNVERIFIED and not tradable.
- Every risk verdict must include reasons with rule name, value, threshold,
  result.
- Every provider module returns typed results, caches, rate limits, and never
  raises on upstream failure.
- Write unit tests for every filter and scoring function, including boundary
  values.
- Read the provider's current API docs before writing integration code; do
  not guess endpoints.
- Long-running jobs (scanner, outcome tracker, regime) run in apps/worker,
  never inside Next.js route handlers.
- Standalone project: no dependency on the Degen Guard bot or Telegram.
- Keep changes small. Implement one task at a time and stop for review.
```

How to work with Cursor:

1. Paste this whole document into `docs/SPEC.md` and tell Cursor to read it first.
2. Work one phase at a time, one task at a time. Prompt example: "Read docs/SPEC.md. Implement Phase 2, task: Jupiter sell-simulation function. Add tests. Do not touch other files."
3. After each task, run the tests and the app yourself before moving on.
4. When Cursor makes up an API field or endpoint, paste the real provider documentation into the chat and ask it to correct the code.

## 10. Later backlog (after launch)

- Vamp detector: group tokens that share a name or narrative and show competing coins (hard to do reliably, so ship it only after the core is proven).
- Rent reclaim helper: list empty token accounts and let the user close them to recover SOL.
- EVM chains (Base, Ethereum, BNB) with GoPlus and Honeypot.is, after testing coverage per chain.
- Community-coin view: activity and sentiment tracking for longer-lived coins.
- Wallet intelligence for discovery only: surface coins that credible wallets hold, with a warning that a visible buy can be a trap. No copy-trading.
- Machine-learning score after enough outcome data exists to beat the rules-based score in backtests.

## 11. Recommended order if time is tight

If you must ship something fast, build Phases 0, 1 and 2 first. A working scanner with a trustworthy, explainable risk verdict is already useful, and it generates the outcome data that every later phase depends on.
