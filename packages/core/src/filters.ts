import type { RiskConfig } from "./config";
import { upOnlyRatio } from "./chart";
import { isOk, type RiskField, type RiskInputs, type RuleResult } from "./types";

function pass(rule: string, value: RuleResult["value"], threshold: RuleResult["threshold"], source: string, detail?: string): RuleResult {
  return { rule, value, threshold, result: "pass", source, detail };
}

function fail(rule: string, value: RuleResult["value"], threshold: RuleResult["threshold"], source: string, detail?: string): RuleResult {
  return { rule, value, threshold, result: "fail", source, detail };
}

function unverified(rule: string, threshold: RuleResult["threshold"], source: string, detail?: string): RuleResult {
  return { rule, value: null, threshold, result: "unverified", source, detail };
}

function fromField<T>(
  field: RiskField<T>,
  rule: string,
  threshold: RuleResult["threshold"],
  fallbackSource: string,
  check: (value: T) => Omit<RuleResult, "rule" | "source"> & { source?: string },
): RuleResult {
  if (!isOk(field)) return unverified(rule, threshold, field.source, field.error ?? "source unavailable");
  const next = check(field.value);
  return { rule, source: next.source ?? fallbackSource, ...next };
}

export function mintAuthorityRevoked(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const { source } = config.hard_filters.mint_authority_revoked;
  return fromField(inputs.mintAuthority, "mint_authority_revoked", "revoked", source, (value) =>
    value === null
      ? { value: "revoked", threshold: "revoked", result: "pass" }
      : { value, threshold: "revoked", result: "fail", detail: "mint authority is still live" },
  );
}

export function freezeAuthorityRevoked(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const { source } = config.hard_filters.freeze_authority_revoked;
  return fromField(inputs.freezeAuthority, "freeze_authority_revoked", "revoked", source, (value) =>
    value === null
      ? { value: "revoked", threshold: "revoked", result: "pass" }
      : { value, threshold: "revoked", result: "fail", detail: "freeze authority is still live" },
  );
}

export function liquidityLockedOrBurned(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.liquidity_locked_or_burned_pct_min;
  if (filter.exempt_on_launchpad_bonding_curve && isOk(inputs.onBondingCurve) && inputs.onBondingCurve.value) {
    return pass("liquidity_locked_or_burned", "bonding_curve", filter.value, filter.source, "exempt while still on a launchpad bonding curve");
  }
  if (filter.exempt_on_launchpad_bonding_curve && !isOk(inputs.onBondingCurve) && !isOk(inputs.lpLockedPct)) {
    return unverified("liquidity_locked_or_burned", filter.value, inputs.lpLockedPct.source, "cannot tell lock percent or bonding-curve status");
  }
  return fromField(inputs.lpLockedPct, "liquidity_locked_or_burned", filter.value, filter.source, (value) => {
    if (value === null) {
      return { value: null, threshold: filter.value, result: "unverified", detail: "lock percent unknown" };
    }
    return value >= filter.value
      ? { value, threshold: filter.value, result: "pass" }
      : { value, threshold: filter.value, result: "fail", detail: `locked/burned ${value}% is below ${filter.value}%` };
  });
}

export function sellSimulation(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.sell_simulation;
  return fromField(inputs.sellSimulation, "sell_simulation", filter.max_price_impact_pct, filter.source, (value) => {
    if (!value.quoted) {
      return {
        value: value.reason ?? "no_quote",
        threshold: filter.max_price_impact_pct,
        result: "fail",
        detail: "Jupiter could not return a sell quote",
      };
    }
    if (value.priceImpactPct === null) {
      return { value: null, threshold: filter.max_price_impact_pct, result: "unverified", detail: "quote had no price impact" };
    }
    return value.priceImpactPct <= filter.max_price_impact_pct
      ? { value: value.priceImpactPct, threshold: filter.max_price_impact_pct, result: "pass" }
      : {
          value: value.priceImpactPct,
          threshold: filter.max_price_impact_pct,
          result: "fail",
          detail: `price impact ${value.priceImpactPct}% exceeds ${filter.max_price_impact_pct}%`,
        };
  });
}

export function largestNonLpHolder(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.largest_non_lp_holder_pct_max;
  return fromField(inputs.largestNonLpHolderPct, "largest_non_lp_holder", filter.value, filter.source, (value) => {
    if (value === null) return { value: null, threshold: filter.value, result: "unverified", detail: "largest holder percent unknown" };
    return value <= filter.value
      ? { value, threshold: filter.value, result: "pass" }
      : { value, threshold: filter.value, result: "fail", detail: `largest non-LP holder is ${value}% of supply` };
  });
}

export function freshWallets(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.fresh_wallets_in_top_20_max;
  return fromField(inputs.freshWalletsInTop20, "fresh_wallets", filter.value, filter.source, (value) =>
    value <= filter.value
      ? { value, threshold: filter.value, result: "pass" }
      : { value, threshold: filter.value, result: "fail", detail: `${value} fresh wallets among top 20` },
  );
}

export function sameSourceFunded(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.same_source_funded_top_holders_max;
  return fromField(inputs.sameSourceFundedTopHolders, "same_source_funded", filter.value, filter.source, (value) =>
    value <= filter.value
      ? { value, threshold: filter.value, result: "pass" }
      : { value, threshold: filter.value, result: "fail", detail: `${value} top holders share one funding source` },
  );
}

export function bundledCluster(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.bundled_cluster_supply_pct_max;
  return fromField(inputs.bundledClusterSupplyPct, "bundled_cluster", filter.value, filter.source, (value) =>
    value <= filter.value
      ? { value, threshold: filter.value, result: "pass" }
      : { value, threshold: filter.value, result: "fail", detail: `largest cluster controls ${value}% of supply` },
  );
}

export function creatorPriorRugs(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.creator_prior_rugs_max;
  return fromField(inputs.creatorPriorRugs, "creator_prior_rugs", filter.value, filter.source, (value) =>
    value <= filter.value
      ? { value, threshold: filter.value, result: "pass" }
      : { value, threshold: filter.value, result: "fail", detail: `creator has ${value} prior rugs` },
  );
}

export function honeypotPattern(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.honeypot_pattern;
  if (!filter.enabled) return pass("honeypot_pattern", "disabled", false, filter.source, "rule disabled in config");

  if (!isOk(inputs.candles)) return unverified("honeypot_pattern", filter.min_up_candle_ratio, inputs.candles.source, "candles unavailable");
  if (!isOk(inputs.volume24hUsd)) return unverified("honeypot_pattern", filter.min_up_candle_ratio, inputs.volume24hUsd.source, "volume unavailable");
  if (!isOk(inputs.marketCapUsd)) return unverified("honeypot_pattern", filter.min_up_candle_ratio, inputs.marketCapUsd.source, "market cap unavailable");
  if (!isOk(inputs.holders)) return unverified("honeypot_pattern", filter.min_up_candle_ratio, inputs.holders.source, "holders unavailable");

  const candles = inputs.candles.value;
  if (candles.length < filter.min_candles) {
    return unverified("honeypot_pattern", filter.min_candles, filter.source, `need ${filter.min_candles} candles, have ${candles.length}`);
  }
  const volume = inputs.volume24hUsd.value;
  const mcap = inputs.marketCapUsd.value;
  const holders = inputs.holders.value;
  if (volume === null || mcap === null || mcap <= 0 || holders === null) {
    return unverified("honeypot_pattern", filter.max_volume_to_mcap_ratio, filter.source, "volume, market cap or holders unknown");
  }

  const upRatio = upOnlyRatio(candles);
  const volRatio = volume / mcap;
  const upOnly = upRatio >= filter.min_up_candle_ratio;
  const lowVolume = volRatio <= filter.max_volume_to_mcap_ratio;
  const fewHolders = holders <= filter.max_holders;
  const triggered = upOnly && lowVolume && fewHolders;
  const value = `up=${upRatio.toFixed(2)},vol/mcap=${volRatio.toFixed(3)},holders=${holders}`;
  return triggered
    ? fail("honeypot_pattern", value, filter.min_up_candle_ratio, filter.source, "up-only chart plus low volume plus few holders")
    : pass("honeypot_pattern", value, filter.min_up_candle_ratio, filter.source);
}

export function minLiquidity(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.min_liquidity_sol;
  if (!isOk(inputs.liquidityUsd)) return unverified("min_liquidity", filter.value, inputs.liquidityUsd.source, "liquidity unavailable");
  if (!isOk(inputs.solUsd)) return unverified("min_liquidity", filter.value, inputs.solUsd.source, "SOL price unavailable");
  const liquidityUsd = inputs.liquidityUsd.value;
  const solUsd = inputs.solUsd.value;
  if (liquidityUsd === null || solUsd === null || solUsd <= 0) {
    return unverified("min_liquidity", filter.value, filter.source, "liquidity or SOL price unknown");
  }
  const liquiditySol = liquidityUsd / solUsd;
  return liquiditySol >= filter.value
    ? pass("min_liquidity", Number(liquiditySol.toFixed(4)), filter.value, filter.source)
    : fail("min_liquidity", Number(liquiditySol.toFixed(4)), filter.value, filter.source, `${liquiditySol.toFixed(2)} SOL liquidity is below ${filter.value} SOL`);
}

/** 24h volume must keep up with market cap. Young pairs need a higher ratio. */
export function volumeVsMcap(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.volume_vs_mcap;
  if (!isOk(inputs.volume24hUsd)) return unverified("volume_vs_mcap", filter.mature_min_ratio, inputs.volume24hUsd.source, "volume unavailable");
  if (!isOk(inputs.marketCapUsd)) return unverified("volume_vs_mcap", filter.mature_min_ratio, inputs.marketCapUsd.source, "market cap unavailable");
  if (!isOk(inputs.ageHours)) return unverified("volume_vs_mcap", filter.mature_min_ratio, inputs.ageHours.source, "pair age unavailable");
  const volume = inputs.volume24hUsd.value;
  const mcap = inputs.marketCapUsd.value;
  const age = inputs.ageHours.value;
  if (volume === null || mcap === null || !(mcap > 0) || age === null) {
    return unverified("volume_vs_mcap", filter.mature_min_ratio, filter.source, "volume, market cap or age unknown");
  }
  const ratio = volume / mcap;
  const min = age < filter.young_hours ? filter.young_min_ratio : filter.mature_min_ratio;
  const shown = Number(ratio.toFixed(4));
  return ratio >= min
    ? pass("volume_vs_mcap", shown, min, filter.source, `vol/mcap=${shown} age=${age.toFixed(1)}h`)
    : fail("volume_vs_mcap", shown, min, filter.source, `24h volume is ${shown}× market cap; need at least ${min}`);
}

/** Either a live 5m or 1h print is enough. Both quiet is a dead book. */
export function recentActivity(inputs: RiskInputs, config: RiskConfig): RuleResult {
  const filter = config.hard_filters.recent_activity;
  if (!isOk(inputs.volume5mUsd) && !isOk(inputs.volume1hUsd)) {
    return unverified("recent_activity", filter.min_volume_5m_usd, "dexscreener", "recent volume unavailable");
  }
  const v5 = isOk(inputs.volume5mUsd) ? inputs.volume5mUsd.value : null;
  const v1 = isOk(inputs.volume1hUsd) ? inputs.volume1hUsd.value : null;
  if (v5 === null && v1 === null) {
    return unverified("recent_activity", filter.min_volume_1h_usd, filter.source, "5m and 1h volume unknown");
  }
  const fiveOk = v5 !== null && v5 >= filter.min_volume_5m_usd;
  const hourOk = v1 !== null && v1 >= filter.min_volume_1h_usd;
  const value = `5m=${v5 ?? "—"},1h=${v1 ?? "—"}`;
  return fiveOk || hourOk
    ? pass("recent_activity", value, filter.min_volume_1h_usd, filter.source)
    : fail("recent_activity", value, filter.min_volume_1h_usd, filter.source, "neither 5m nor 1h volume meets the activity floor");
}

const FILTERS = [
  mintAuthorityRevoked,
  freezeAuthorityRevoked,
  liquidityLockedOrBurned,
  sellSimulation,
  largestNonLpHolder,
  freshWallets,
  sameSourceFunded,
  bundledCluster,
  creatorPriorRugs,
  honeypotPattern,
  minLiquidity,
  volumeVsMcap,
  recentActivity,
] as const;

export function runHardFilters(inputs: RiskInputs, config: RiskConfig): RuleResult[] {
  return FILTERS.map((fn) => fn(inputs, config));
}

export function hardFilterVerdict(reasons: RuleResult[]): "BLOCKED" | "UNVERIFIED" | "PASS" {
  if (reasons.some((r) => r.result === "fail")) return "BLOCKED";
  if (reasons.some((r) => r.result === "unverified")) return "UNVERIFIED";
  return "PASS";
}
