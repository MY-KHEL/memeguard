import { z } from "zod";
import { verdictSchema } from "./verdict";

export const SCORE_BANDS = ["LOWER_RISK", "MEDIUM", "HIGH"] as const;
export const scoreBandSchema = z.enum(SCORE_BANDS);
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const ruleResultSchema = z.object({
  rule: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  threshold: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  result: z.enum(["pass", "fail", "unverified"]),
  source: z.string(),
  detail: z.string().optional(),
});
export type RuleResultDto = z.infer<typeof ruleResultSchema>;

export const factorScoreSchema = z.object({
  factor: z.string(),
  raw: z.number().nullable(),
  weight: z.number(),
  appliedWeight: z.number(),
  score: z.number().nullable(),
  disabled: z.boolean(),
  unverified: z.boolean(),
  detail: z.string().optional(),
});

export const riskReportSchema = z.object({
  mint: z.string(),
  verdict: verdictSchema,
  score: z.number().int().nullable(),
  band: scoreBandSchema.nullable(),
  reasons: z.array(ruleResultSchema),
  factors: z.array(factorScoreSchema),
  unavailableSources: z.array(z.string()),
  dataFreshness: z.string().datetime(),
  configVersion: z.string(),
  evaluatedAt: z.string().datetime(),
  pending: z.boolean().optional(),
});
export type RiskReportDto = z.infer<typeof riskReportSchema>;

export const tradeCandidateSchema = z.object({
  mint: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  imageUrl: z.string().nullable(),
  score: z.number().int(),
  band: scoreBandSchema,
  marketCapUsd: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  volume24hUsd: z.number().nullable(),
  volume1hUsd: z.number().nullable(),
  priceUsd: z.number().nullable(),
  summary: z.string(),
  evaluatedAt: z.string().datetime(),
});
export type TradeCandidate = z.infer<typeof tradeCandidateSchema>;

export const tradeCandidatesResponseSchema = z.object({
  items: z.array(tradeCandidateSchema),
  generatedAt: z.string().datetime(),
});
