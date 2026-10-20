import type { Verdict } from "@meme-guard/shared-types";
import type { ScoreBand } from "./index";

/**
 * Every risk input is either a known value or an unavailable source.
 * Unavailable is never treated as a pass (docs/SPEC.md section 1).
 */
export type Available<T> = { status: "ok"; value: T };
export type Unavailable = { status: "unavailable"; source: string; error?: string };
export type RiskField<T> = Available<T> | Unavailable;

export function ok<T>(value: T): Available<T> {
  return { status: "ok", value };
}

export function unavailable(source: string, error?: string): Unavailable {
  return { status: "unavailable", source, error };
}

export function isOk<T>(field: RiskField<T>): field is Available<T> {
  return field.status === "ok";
}

export type RuleOutcome = "pass" | "fail" | "unverified";

export interface RuleResult {
  rule: string;
  value: string | number | boolean | null;
  threshold: string | number | boolean | null;
  result: RuleOutcome;
  source: string;
  detail?: string;
}

export interface CandleInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RiskInputs {
  mintAuthority: RiskField<string | null>;
  freezeAuthority: RiskField<string | null>;
  lpLockedPct: RiskField<number | null>;
  onBondingCurve: RiskField<boolean>;
  sellSimulation: RiskField<{ quoted: boolean; priceImpactPct: number | null; reason?: string }>;
  largestNonLpHolderPct: RiskField<number | null>;
  freshWalletsInTop20: RiskField<number>;
  sameSourceFundedTopHolders: RiskField<number>;
  bundledClusterSupplyPct: RiskField<number>;
  creatorPriorRugs: RiskField<number>;
  candles: RiskField<CandleInput[]>;
  volume24hUsd: RiskField<number | null>;
  volume5mUsd: RiskField<number | null>;
  volume1hUsd: RiskField<number | null>;
  marketCapUsd: RiskField<number | null>;
  holders: RiskField<number | null>;
  liquidityUsd: RiskField<number | null>;
  solUsd: RiskField<number | null>;
  top5Pct: RiskField<number | null>;
  top10Pct: RiskField<number | null>;
  ageHours: RiskField<number | null>;
  feesPaidSol: RiskField<number | null>;
  devBoughtMcapPct: RiskField<number | null>;
  devSold: RiskField<boolean>;
  /** Other mints sharing this name or symbol inside the crowding window. */
  sameNamePeers: RiskField<number | null>;
}

export interface FactorScore {
  factor: string;
  raw: number | null;
  weight: number;
  appliedWeight: number;
  score: number | null;
  disabled: boolean;
  unverified: boolean;
  detail?: string;
}

export interface RiskEvaluation {
  verdict: Verdict;
  score: number | null;
  band: ScoreBand | null;
  reasons: RuleResult[];
  factors: FactorScore[];
  unavailableSources: string[];
  dataFreshness: string;
  configVersion: string;
}

export const HARD_FILTER_RULES = [
  "mint_authority_revoked",
  "freeze_authority_revoked",
  "liquidity_locked_or_burned",
  "sell_simulation",
  "largest_non_lp_holder",
  "fresh_wallets",
  "same_source_funded",
  "bundled_cluster",
  "creator_prior_rugs",
  "honeypot_pattern",
  "min_liquidity",
] as const;
export type HardFilterRule = (typeof HARD_FILTER_RULES)[number];
