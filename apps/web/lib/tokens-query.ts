import { and, asc, desc, eq, gt, ilike, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";
import {
  looksLikeMint,
  tokenListItemSchema,
  tokenListResponseSchema,
  type TokenListItem,
  type TokenListQuery,
  type TokenListResponse,
  type Verdict,
} from "@meme-guard/shared-types";

/**
 * Explore list query. One indexed SELECT on tokens plus a lateral lookup of
 * the latest risk report. No report yet means UNVERIFIED (fail closed).
 */

const t = schema.tokens;

const num = (v: string | null) => (v === null ? null : Number(v));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

type Row = {
  mint: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  launchpad: string | null;
  dexId: string | null;
  pairAddress: string | null;
  latestPrice: string | null;
  latestMarketCap: string | null;
  latestLiquidityUsd: string | null;
  latestVolume24h: string | null;
  latestPriceChange1h: string | null;
  createdAt: Date | null;
  firstSeenAt: Date;
  lastSnapshotAt: Date | null;
  verdict: Verdict | null;
  riskScore: number | null;
};

export function rowToListItem(row: Row): TokenListItem {
  return tokenListItemSchema.parse({
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    imageUrl: row.imageUrl,
    launchpad: row.launchpad,
    dexId: row.dexId,
    pairAddress: row.pairAddress,
    priceUsd: num(row.latestPrice),
    marketCapUsd: num(row.latestMarketCap),
    liquidityUsd: num(row.latestLiquidityUsd),
    volume24hUsd: num(row.latestVolume24h),
    priceChange1hPct: num(row.latestPriceChange1h),
    createdAt: iso(row.createdAt),
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSnapshotAt: iso(row.lastSnapshotAt),
    verdict: row.verdict ?? "UNVERIFIED",
    riskScore: row.riskScore,
  });
}

/** Latest risk report per mint, joined laterally so the list stays one query. */
const latestReport = sql<string>`(select rr.verdict from risk_reports rr where rr.mint = ${t.mint} order by rr.ts desc limit 1)`;
const latestScore = sql<number>`(select rr.score from risk_reports rr where rr.mint = ${t.mint} order by rr.ts desc limit 1)`;

const selection = {
  mint: t.mint,
  symbol: t.symbol,
  name: t.name,
  imageUrl: t.imageUrl,
  launchpad: t.launchpad,
  dexId: t.dexId,
  pairAddress: t.pairAddress,
  latestPrice: t.latestPrice,
  latestMarketCap: t.latestMarketCap,
  latestLiquidityUsd: t.latestLiquidityUsd,
  latestVolume24h: t.latestVolume24h,
  latestPriceChange1h: t.latestPriceChange1h,
  createdAt: t.createdAt,
  firstSeenAt: t.firstSeenAt,
  lastSnapshotAt: t.lastSnapshotAt,
  verdict: sql<Verdict | null>`${latestReport}`.as("verdict"),
  riskScore: sql<number | null>`${latestScore}`.as("risk_score"),
};

function sortColumn(sort: TokenListQuery["sort"]) {
  switch (sort) {
    case "market_cap":
      return t.latestMarketCap;
    case "volume_24h":
      return t.latestVolume24h;
    case "liquidity":
      return t.latestLiquidityUsd;
    case "age":
      return t.createdAt;
    case "first_seen":
    default:
      return t.firstSeenAt;
  }
}

/** Cursor = base64url of JSON [sortValue, mint]; the mint breaks ties deterministically. */
function encodeCursor(value: string | null, mint: string): string {
  return Buffer.from(JSON.stringify([value, mint]), "utf8").toString("base64url");
}
function decodeCursor(cursor: string): { value: string | null; mint: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[1] !== "string") return null;
    const value = parsed[0];
    if (value !== null && typeof value !== "string") return null;
    return { value, mint: parsed[1] };
  } catch {
    return null;
  }
}

export async function listTokens(db: Database, q: TokenListQuery, now = new Date()): Promise<TokenListResponse> {
  const where: SQL[] = [];

  if (q.q) {
    const term = q.q.trim();
    if (looksLikeMint(term)) {
      where.push(eq(t.mint, term));
    } else {
      const pattern = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(t.symbol, pattern), ilike(t.name, pattern))!);
    }
  }
  if (q.minLiquidity !== undefined) where.push(sql`${t.latestLiquidityUsd} >= ${String(q.minLiquidity)}`);
  if (q.minVolume24h !== undefined) where.push(sql`${t.latestVolume24h} >= ${String(q.minVolume24h)}`);
  if (q.maxAgeHours !== undefined) {
    const since = new Date(now.getTime() - q.maxAgeHours * 3600 * 1000);
    where.push(sql`coalesce(${t.createdAt}, ${t.firstSeenAt}) >= ${since}`);
  }
  if (q.launchpad) where.push(eq(t.launchpad, q.launchpad));
  if (q.verdict) {
    where.push(q.verdict === "UNVERIFIED" ? sql`coalesce(${latestReport}, 'UNVERIFIED') = 'UNVERIFIED'` : sql`${latestReport} = ${q.verdict}`);
  }

  const col = sortColumn(q.sort);
  const direction = q.dir === "asc" ? asc : desc;
  // Nulls always last so unknown values never float to the top of a ranking.
  const orderBy = [sql`${col} ${sql.raw(q.dir === "asc" ? "asc" : "desc")} nulls last`, direction(t.mint)];

  const baseWhere = where.length ? and(...where) : undefined;
  const pageWhere: SQL[] = baseWhere ? [baseWhere] : [];

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    if (c) {
      const cmp = q.dir === "asc" ? gt : lt;
      if (c.value === null) {
        // Inside the null tail: only paginate by mint.
        pageWhere.push(and(sql`${col} is null`, cmp(t.mint, c.mint))!);
      } else {
        const bound = col === t.firstSeenAt || col === t.createdAt ? new Date(c.value) : c.value;
        pageWhere.push(or(cmp(col, bound), and(eq(col, bound), cmp(t.mint, c.mint)), sql`${col} is null`)!);
      }
    }
  }

  const rows = await db
    .select(selection)
    .from(t)
    .where(pageWhere.length ? and(...pageWhere) : undefined)
    .orderBy(...orderBy)
    .limit(q.limit + 1);

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(baseWhere);

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit) as Row[];
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          (() => {
            const v = last[colKey(q.sort)];
            if (v === null || v === undefined) return null;
            return v instanceof Date ? v.toISOString() : String(v);
          })(),
          last.mint,
        )
      : null;

  return tokenListResponseSchema.parse({
    items: page.map(rowToListItem),
    nextCursor,
    total: countRow?.n ?? 0,
    generatedAt: now.toISOString(),
  });
}

function colKey(sort: TokenListQuery["sort"]): keyof Row {
  switch (sort) {
    case "market_cap":
      return "latestMarketCap";
    case "volume_24h":
      return "latestVolume24h";
    case "liquidity":
      return "latestLiquidityUsd";
    case "age":
      return "createdAt";
    default:
      return "firstSeenAt";
  }
}

export async function getTokenRow(db: Database, mint: string): Promise<Row | null> {
  const [row] = await db.select(selection).from(t).where(eq(t.mint, mint)).limit(1);
  return (row as Row | undefined) ?? null;
}

export async function getRecentSnapshots(db: Database, mint: string, limit = 60) {
  const s = schema.tokenSnapshots;
  const rows = await db
    .select({
      ts: s.ts,
      price: s.price,
      marketCap: s.marketCap,
      liquidityUsd: s.liquidityUsd,
      volume5m: s.volume5m,
      volume1h: s.volume1h,
      volume24h: s.volume24h,
      holders: s.holders,
    })
    .from(s)
    .where(and(eq(s.mint, mint), isNotNull(s.ts)))
    .orderBy(desc(s.ts))
    .limit(limit);
  return rows.reverse().map((row) => ({
    ts: row.ts.toISOString(),
    priceUsd: num(row.price),
    marketCapUsd: num(row.marketCap),
    liquidityUsd: num(row.liquidityUsd),
    volume5mUsd: num(row.volume5m),
    volume1hUsd: num(row.volume1h),
    volume24hUsd: num(row.volume24h),
    holders: row.holders,
  }));
}
