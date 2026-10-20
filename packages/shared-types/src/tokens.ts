import { z } from "zod";
import { verdictSchema } from "./verdict";

/**
 * Shapes shared by the web API routes and the Explore UI (Phase 1).
 * Numbers that may be unknown are null, never 0, so the UI can show a dash
 * instead of implying a value.
 */

const nullableNumber = z.number().nullable();
const isoDate = z.string().datetime({ offset: true });

export const tokenListItemSchema = z.object({
  mint: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  imageUrl: z.string().nullable(),
  launchpad: z.string().nullable(),
  dexId: z.string().nullable(),
  pairAddress: z.string().nullable(),
  priceUsd: nullableNumber,
  marketCapUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  volume24hUsd: nullableNumber,
  priceChange1hPct: nullableNumber,
  createdAt: isoDate.nullable(),
  firstSeenAt: isoDate,
  lastSnapshotAt: isoDate.nullable(),
  verdict: verdictSchema,
  riskScore: z.number().int().nullable(),
});
export type TokenListItem = z.infer<typeof tokenListItemSchema>;

export const TOKEN_SORTS = ["first_seen", "market_cap", "volume_24h", "liquidity", "age"] as const;
export const tokenSortSchema = z.enum(TOKEN_SORTS);
export type TokenSort = z.infer<typeof tokenSortSchema>;

export const tokenListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  sort: tokenSortSchema.default("first_seen"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  minLiquidity: z.coerce.number().nonnegative().optional(),
  minVolume24h: z.coerce.number().nonnegative().optional(),
  maxAgeHours: z.coerce.number().positive().optional(),
  launchpad: z.string().trim().max(40).optional(),
  verdict: verdictSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque keyset cursor returned by the previous page. */
  cursor: z.string().max(200).optional(),
});
export type TokenListQuery = z.infer<typeof tokenListQuerySchema>;

export const tokenListResponseSchema = z.object({
  items: z.array(tokenListItemSchema),
  nextCursor: z.string().nullable(),
  /** Total tracked tokens matching the filters, capped for cheapness. */
  total: z.number().int(),
  generatedAt: isoDate,
});
export type TokenListResponse = z.infer<typeof tokenListResponseSchema>;

export const tokenSnapshotSchema = z.object({
  ts: isoDate,
  priceUsd: nullableNumber,
  marketCapUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  volume5mUsd: nullableNumber,
  volume1hUsd: nullableNumber,
  volume24hUsd: nullableNumber,
  holders: z.number().int().nullable(),
});
export type TokenSnapshot = z.infer<typeof tokenSnapshotSchema>;

export const tokenDetailSchema = tokenListItemSchema.extend({
  creatorWallet: z.string().nullable(),
  supplyUi: nullableNumber,
  decimals: z.number().int().nullable(),
  mintAuthority: z.string().nullable(),
  freezeAuthority: z.string().nullable(),
  quoteSymbol: z.string().nullable(),
  snapshots: z.array(tokenSnapshotSchema),
  /** Which data sources answered. Missing data is reported, never hidden. */
  sources: z.object({
    metadata: z.enum(["helius", "dexscreener", "none"]),
  }),
});
export type TokenDetail = z.infer<typeof tokenDetailSchema>;

export const CANDLE_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export const candleTimeframeSchema = z.enum(CANDLE_TIMEFRAMES);
export type CandleTimeframe = z.infer<typeof candleTimeframeSchema>;

export const candleSchema = z.object({
  time: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export type Candle = z.infer<typeof candleSchema>;

export const holderSchema = z.object({
  address: z.string(),
  isTokenAccount: z.boolean(),
  uiAmount: nullableNumber,
  pctOfSupply: nullableNumber,
});
export type Holder = z.infer<typeof holderSchema>;

/**
 * Market-data routes return 200 with ok:false when a provider is down or not
 * configured, so the UI can render the rest of the page and name the gap.
 */
export const providerFailureReasonSchema = z.enum([
  "unavailable",
  "rate_limited",
  "timeout",
  "invalid_response",
  "not_configured",
  "not_found",
]);

export const providerDataResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data, source: z.string(), fetchedAt: isoDate, fromCache: z.boolean() }),
    z.object({ ok: z.literal(false), reason: providerFailureReasonSchema, source: z.string(), error: z.string().optional() }),
  ]);

export const candlesResponseSchema = providerDataResponseSchema(z.array(candleSchema));
export type CandlesResponse = z.infer<typeof candlesResponseSchema>;

export const holdersResponseSchema = providerDataResponseSchema(z.array(holderSchema));
export type HoldersResponse = z.infer<typeof holdersResponseSchema>;

/** Solana addresses are base58, 32 to 44 characters. */
export const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function looksLikeMint(value: string): boolean {
  return BASE58_ADDRESS_RE.test(value.trim());
}
