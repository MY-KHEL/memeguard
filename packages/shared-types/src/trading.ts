import { z } from "zod";
import { candleTimeframeSchema } from "./tokens";
import { mistakeTagSchema, positionModeSchema, regimeSchema } from "./verdict";
import { scoreBandSchema } from "./risk";

const iso = z.string().datetime({ offset: true });

export const ladderStepSchema = z.object({
  multiple: z.number().positive(),
  sellPct: z.number().positive(),
  hitAt: iso.optional(),
});
export type LadderStep = z.infer<typeof ladderStepSchema>;

export const exitPlanSchema = z.object({
  sellReason: z.string().min(1),
  stopPct: z.number().positive(),
  stopPriceUsd: z.number().nullable(),
  ladder: z.array(ladderStepSchema),
  fomoConfirmed: z.boolean().optional(),
  recheckAckedAt: iso.optional(),
});
export type ExitPlan = z.infer<typeof exitPlanSchema>;

export const alertPrefsSchema = z.object({
  passCoins: z.boolean(),
  passScoreMin: z.number().int().min(0).max(100),
  stops: z.boolean(),
  dailyLoss: z.boolean(),
  verdictChange: z.boolean(),
  webPush: z.boolean(),
  email: z.boolean(),
});
export type AlertPrefs = z.infer<typeof alertPrefsSchema>;

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  passCoins: true,
  passScoreMin: 50,
  stops: true,
  dailyLoss: true,
  verdictChange: true,
  webPush: false,
  email: false,
};

export const limitOverridesSchema = z.object({
  maxPctPerCoin: z.number().optional(),
  maxOpenPositions: z.number().optional(),
  maxPctLowMcap: z.number().optional(),
  dailyLossPct: z.number().optional(),
  cooldownAfterLossMinutes: z.number().optional(),
  highRiskMaxPct: z.number().optional(),
});
export type LimitOverridesDto = z.infer<typeof limitOverridesSchema>;

export const settingsPatchSchema = z.object({
  limits: limitOverridesSchema.optional(),
  alerts: alertPrefsSchema.partial().optional(),
});

const resolvedLimitsSchema = z.object({
  maxPctPerCoin: z.number(),
  maxOpenPositions: z.number(),
  lowMcapUsd: z.number(),
  maxPctLowMcap: z.number(),
  dailyLossPct: z.number(),
  cooldownAfterLossMinutes: z.number(),
  highRiskMaxPct: z.number(),
});

export const sessionUserSchema = z.object({
  userId: z.string().uuid(),
  wallet: z.string(),
  paperBalanceSol: z.number(),
  /** Effective caps after COLD multiplier. Use for trade/portfolio display. */
  limits: resolvedLimitsSchema,
  /** Saved prefs before regime. Settings form must edit these, not `limits`. */
  limitSettings: resolvedLimitsSchema,
  dailyLossLocked: z.boolean(),
  cooldownUntil: z.string().nullable(),
  devAuthAvailable: z.boolean(),
  regime: regimeSchema.nullable(),
  alerts: z.object({
    passCoins: z.boolean(),
    passScoreMin: z.number().int().min(0).max(100),
    stops: z.boolean(),
    dailyLoss: z.boolean(),
    verdictChange: z.boolean(),
    webPush: z.boolean(),
    email: z.boolean(),
  }),
  pushEmailConfigured: z.object({ webPush: z.boolean(), email: z.boolean() }),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meResponseSchema = sessionUserSchema;
export type MeResponse = SessionUser;

export const paperPreviewSchema = z.object({
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  sizeSol: z.number().positive().optional(),
  tokenAmount: z.number().positive().optional(),
  fomoConfirmed: z.boolean().optional(),
});

export const paperBuySchema = z.object({
  mint: z.string().min(32).max(64),
  sizeSol: z.number().positive(),
  thesis: z.string().min(1),
  sellReason: z.string().min(1),
  stopPct: z.number().positive(),
  ladder: z.array(ladderStepSchema).min(1),
  fomoConfirmed: z.boolean().optional(),
});
export type PaperBuyInput = z.infer<typeof paperBuySchema>;

export const paperSellSchema = z.object({
  positionId: z.string().uuid(),
  tokenAmount: z.number().positive().optional(),
  close: z.boolean().optional(),
});
export type PaperSellInput = z.infer<typeof paperSellSchema>;

export const quotePreviewSchema = z.object({
  ok: z.boolean(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  sizeSol: z.number().nullable(),
  tokenAmount: z.number().nullable(),
  expectedOut: z.number().nullable(),
  fillPriceSol: z.number().nullable(),
  priceImpactPct: z.number().nullable(),
  fomo: z.boolean(),
  violations: z.array(
    z.object({
      rule: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      threshold: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      result: z.enum(["pass", "fail"]),
      detail: z.string().optional(),
    }),
  ),
  applied: z
    .object({
      maxPct: z.number(),
      maxSizeSol: z.number(),
      maxOpenPositions: z.number(),
      dailyLossLocked: z.boolean(),
      cooldownUntil: z.string().nullable(),
    })
    .nullable(),
});
export type QuotePreview = z.infer<typeof quotePreviewSchema>;

export const positionDtoSchema = z.object({
  id: z.string().uuid(),
  mint: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  imageUrl: z.string().nullable(),
  mode: positionModeSchema,
  status: z.enum(["open", "closed"]),
  thesis: z.string(),
  exitPlan: exitPlanSchema,
  entryPriceUsd: z.number(),
  sizeSol: z.number(),
  remainingTokens: z.number(),
  remainingCostSol: z.number(),
  markPriceUsd: z.number().nullable(),
  markValueSol: z.number().nullable(),
  unrealizedPnlSol: z.number().nullable(),
  unrealizedPct: z.number().nullable(),
  realizedPnlSol: z.number().nullable(),
  scoreBand: scoreBandSchema.nullable(),
  stopHit: z.boolean(),
  ladderHits: z.array(z.number()),
  recheck: z.boolean(),
  openedAt: iso,
  closedAt: iso.nullable(),
});
export type PositionDto = z.infer<typeof positionDtoSchema>;

export const portfolioResponseSchema = z.object({
  paperBalanceSol: z.number(),
  equitySol: z.number(),
  exposureSol: z.number(),
  dailyLossLocked: z.boolean(),
  cooldownUntil: z.string().nullable(),
  limits: sessionUserSchema.shape.limits,
  open: z.array(positionDtoSchema),
  closed: z.array(positionDtoSchema),
});
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

export const journalEntrySchema = z.object({
  id: z.string().uuid(),
  positionId: z.string().uuid().nullable(),
  mint: z.string().nullable(),
  symbol: z.string().nullable(),
  thesis: z.string(),
  outcomeNotes: z.string().nullable(),
  mistakeTag: mistakeTagSchema.nullable(),
  createdAt: iso,
});
export type JournalEntryDto = z.infer<typeof journalEntrySchema>;

export const journalResponseSchema = z.object({
  items: z.array(journalEntrySchema),
});

export const journalPatchSchema = z.object({
  mistakeTag: mistakeTagSchema,
});

export const tokenTickSchema = z.object({
  type: z.literal("token.tick"),
  mint: z.string(),
  priceUsd: z.number().nullable(),
  marketCapUsd: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  volume24hUsd: z.number().nullable(),
  priceChange1hPct: z.number().nullable(),
  ts: iso,
});
export type TokenTick = z.infer<typeof tokenTickSchema>;

export const tokenCandleSchema = z.object({
  type: z.literal("token.candle"),
  mint: z.string(),
  timeframe: candleTimeframeSchema,
  time: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
  ts: iso,
});
export type TokenCandle = z.infer<typeof tokenCandleSchema>;

export const tokenStatsSchema = z.object({
  type: z.literal("token.stats"),
  mint: z.string(),
  circulatingSupply: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  volume24hUsd: z.number().nullable(),
  priceChange1hPct: z.number().nullable(),
  ts: iso,
});
export type TokenStats = z.infer<typeof tokenStatsSchema>;

export const verdictTickSchema = z.object({
  type: z.literal("token.verdict"),
  mint: z.string(),
  verdict: z.enum(["PASS", "BLOCKED", "UNVERIFIED"]),
  score: z.number().int().nullable(),
  band: scoreBandSchema.nullable(),
  ts: iso,
});

export const positionTickSchema = z.object({
  type: z.literal("position.update"),
  userId: z.string().uuid(),
  positionId: z.string().uuid(),
  ts: iso,
});

export const heartbeatTickSchema = z.object({
  type: z.literal("heartbeat"),
  ts: iso,
});

export const regimeTickSchema = z.object({
  type: z.literal("regime.update"),
  regime: regimeSchema,
  ts: iso,
});

export const notificationTickSchema = z.object({
  type: z.literal("notification.new"),
  userId: z.string().uuid(),
  notificationId: z.string().uuid(),
  ts: iso,
});

export const liveEventSchema = z.discriminatedUnion("type", [
  tokenTickSchema,
  tokenCandleSchema,
  tokenStatsSchema,
  verdictTickSchema,
  positionTickSchema,
  heartbeatTickSchema,
  regimeTickSchema,
  notificationTickSchema,
]);

export const NOTIFICATION_TYPES = ["pass_coin", "stop_hit", "ladder_hit", "daily_loss", "verdict_blocked"] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const notificationDtoSchema = z.object({
  id: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()),
  urgent: z.boolean(),
  readAt: iso.nullable(),
  createdAt: iso,
});
export type NotificationDto = z.infer<typeof notificationDtoSchema>;

export const notificationsResponseSchema = z.object({
  items: z.array(notificationDtoSchema),
  unread: z.number().int().nonnegative(),
});

export const regimeSnapshotSchema = z.object({
  regime: regimeSchema,
  btcTrend: z.string().nullable(),
  ethTrend: z.string().nullable(),
  solTrend: z.string().nullable(),
  memecoinVolumeIndex: z.number().nullable(),
  avgPeakMcap: z.number().nullable(),
  ts: iso,
});
export type RegimeSnapshotDto = z.infer<typeof regimeSnapshotSchema>;

export const calibrationReportSchema = z.object({
  generatedAt: iso,
  outcomeCount: z.number().int().nonnegative(),
  oldestBaseTs: iso.nullable(),
  newestBaseTs: iso.nullable(),
  enoughHistory: z.boolean(),
  byRule: z.array(
    z.object({
      rule: z.string(),
      blocked: z.number().int().nonnegative(),
      rugged: z.number().int().nonnegative(),
      ruggedRate: z.number().nullable(),
    }),
  ),
  byBand: z.array(
    z.object({
      band: z.string(),
      pass: z.number().int().nonnegative(),
      avgReturnPct: z.number().nullable(),
    }),
  ),
  byConfigVersion: z.array(
    z.object({
      configVersion: z.string(),
      reports: z.number().int().nonnegative(),
      rugged: z.number().int().nonnegative(),
    }),
  ),
});
export type CalibrationReport = z.infer<typeof calibrationReportSchema>;
export type LiveEvent = z.infer<typeof liveEventSchema>;
