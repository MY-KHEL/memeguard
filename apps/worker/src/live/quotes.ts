import { sql } from "drizzle-orm";
import type { Database } from "@meme-guard/db";
import { pickBestPair, type Providers } from "@meme-guard/providers";
import { tradingConfig } from "@meme-guard/trading";
import { withDbWrite } from "../db-lock";
import type { Logger } from "../logger";
import type { LiveBus } from "./bus";
import { toNumeric, toPct } from "../scanner/enrich";

const QUOTE_CHUNK = 30;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function readBand(raw: unknown): "LOWER_RISK" | "MEDIUM" | "HIGH" | null {
  if (!raw || typeof raw !== "object") return null;
  const band = (raw as { band?: unknown }).band;
  if (band === "LOWER_RISK" || band === "MEDIUM" || band === "HIGH") return band;
  return null;
}

export function createLiveQuotes(deps: {
  db: Database;
  providers: Providers;
  bus: LiveBus;
  log: Logger;
  intervalMs: number;
  maxWatched: number;
}) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const publishedVerdict = new Map<string, string>();

  async function publishVerdicts(mints: string[]) {
    const kept = new Set(mints);
    for (const mint of publishedVerdict.keys()) {
      if (!kept.has(mint)) publishedVerdict.delete(mint);
    }
    const reports = await deps.db.execute<{
      mint: string;
      verdict: string;
      score: number | null;
      score_breakdown: unknown;
    }>(sql`
      select distinct on (mint) mint, verdict, score, score_breakdown
      from risk_reports
      where mint in (${sql.join(mints.map((mint) => sql`${mint}`), sql`, `)})
      order by mint, ts desc
    `);
    const now = new Date().toISOString();
    for (const row of reports) {
      const verdict = row.verdict === "PASS" || row.verdict === "BLOCKED" || row.verdict === "UNVERIFIED" ? row.verdict : null;
      if (!verdict) continue;
      const score = row.score === null || row.score === undefined ? null : Number(row.score);
      const band = readBand(row.score_breakdown);
      const signature = `${verdict}:${score ?? ""}:${band ?? ""}`;
      if (publishedVerdict.get(row.mint) === signature) continue;
      publishedVerdict.set(row.mint, signature);
      await deps.bus.publish({
        type: "token.verdict",
        mint: row.mint,
        verdict,
        score: score !== null && Number.isFinite(score) ? score : null,
        band,
        ts: now,
      });
    }
  }

  async function tick() {
    const mints = await deps.bus.watchedMints(deps.maxWatched);
    if (mints.length === 0) return;
    try {
      await publishVerdicts(mints);
    } catch (error) {
      deps.log.warn({ err: String(error) }, "live verdict publish failed");
    }
    for (const part of chunk(mints, QUOTE_CHUNK)) {
      if (stopped) return;
      await publishQuoteChunk(part);
    }
  }

  async function publishQuoteChunk(mints: string[]) {
    const market = await deps.providers.dexscreener.getTokens("solana", mints, { ttlSeconds: 1 });
    if (!market.ok) {
      deps.log.warn({ reason: market.reason, mints: mints.length }, "live quotes batch failed");
      return;
    }
    const now = new Date();
    const rows: Array<{
      mint: string;
      priceUsd: string | null;
      marketCapUsd: string | null;
      liquidityUsd: string | null;
      volume24hUsd: string | null;
      priceChange1hPct: string | null;
    }> = [];
    for (const mint of mints) {
      const pairs = market.data.filter((p) => p.baseToken.address === mint);
      const best = pickBestPair(pairs, mint);
      if (!best) continue;
      rows.push({
        mint,
        priceUsd: toNumeric(best.priceUsd),
        marketCapUsd: toNumeric(best.marketCap ?? best.fdv),
        liquidityUsd: toNumeric(best.liquidity?.usd),
        volume24hUsd: toNumeric(best.volume?.h24),
        priceChange1hPct: toPct(best.priceChange?.h1),
      });
    }
    if (rows.length === 0) return;

    const ts = now.toISOString();
    for (const row of rows) {
      await deps.bus.publish({
        type: "token.tick",
        mint: row.mint,
        priceUsd: row.priceUsd === null ? null : Number(row.priceUsd),
        marketCapUsd: row.marketCapUsd === null ? null : Number(row.marketCapUsd),
        liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
        volume24hUsd: row.volume24hUsd === null ? null : Number(row.volume24hUsd),
        priceChange1hPct: row.priceChange1hPct === null ? null : Number(row.priceChange1hPct),
        ts,
      });
    }

    try {
      const values = sql.join(
        rows.map(
          (row) =>
            sql`(${row.mint}::text, ${row.priceUsd}::numeric, ${row.marketCapUsd}::numeric, ${row.liquidityUsd}::numeric, ${row.volume24hUsd}::numeric, ${row.priceChange1hPct}::numeric, ${ts}::timestamptz)`,
        ),
        sql`, `,
      );
      await withDbWrite(() =>
        deps.db.execute(sql`
          update tokens as t set
            latest_price = v.price,
            latest_market_cap = v.mcap,
            latest_liquidity_usd = v.liq,
            latest_volume_24h = v.vol,
            latest_price_change_1h = v.chg,
            last_snapshot_at = v.ts
          from (values ${values}) as v(mint, price, mcap, liq, vol, chg, ts)
          where t.mint = v.mint
        `),
      );
    } catch (error) {
      deps.log.warn({ err: String(error), mints: rows.length }, "live quote persist failed");
    }
  }

  return {
    start() {
      stopped = false;
      let running = false;
      deps.log.info({ intervalMs: deps.intervalMs, maxWatched: deps.maxWatched, config: tradingConfig.config_version }, "live quotes starting");
      const loop = () => {
        if (stopped) return;
        timer = setTimeout(loop, deps.intervalMs);
        if (running) return;
        running = true;
        void tick()
          .catch((error: unknown) => deps.log.warn({ err: String(error) }, "live quotes tick failed"))
          .finally(() => {
            running = false;
          });
      };
      loop();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
