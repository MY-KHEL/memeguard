import type { RiskConfig, ScoreBand } from "./config";
import { analyseChart } from "./chart";
import { isOk, type FactorScore, type RiskInputs } from "./types";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Linear map: at `full` the score is 1, at `zero` it is 0. */
export function lerpScore(value: number, full: number, zero: number): number {
  if (full === zero) return value >= full ? 1 : 0;
  return clamp01((value - zero) / (full - zero));
}

export function effectiveWeights(config: RiskConfig): Record<string, number> {
  const disabled = new Set(config.scoring.disabled_factors);
  const entries = Object.entries(config.scoring.weights);
  const active = entries.filter(([name, weight]) => !disabled.has(name) && weight > 0);
  const activeTotal = active.reduce((s, [, w]) => s + w, 0);
  const disabledTotal = entries.filter(([name]) => disabled.has(name)).reduce((s, [, w]) => s + w, 0);
  const redistribute = config.scoring.redistribute_disabled_weights && activeTotal > 0 && disabledTotal > 0;
  const out: Record<string, number> = {};
  for (const [name, weight] of entries) {
    if (disabled.has(name) || weight <= 0) {
      out[name] = 0;
      continue;
    }
    out[name] = redistribute ? weight + (weight / activeTotal) * disabledTotal : weight;
  }
  return out;
}

function unverifiedFactor(factor: string, weight: number, applied: number, detail: string): FactorScore {
  return { factor, raw: null, weight, appliedWeight: applied, score: null, disabled: false, unverified: true, detail };
}

function scored(factor: string, weight: number, applied: number, raw: number, score: number, detail?: string): FactorScore {
  return { factor, raw, weight, appliedWeight: applied, score, disabled: applied === 0 && weight > 0, unverified: false, detail };
}

function disabled(factor: string, weight: number): FactorScore {
  return { factor, raw: null, weight, appliedWeight: 0, score: null, disabled: true, unverified: false, detail: "disabled in config" };
}

export function scoreLiquidityDepth(inputs: RiskInputs, config: RiskConfig, applied: number): FactorScore {
  const weight = config.scoring.weights.liquidity_depth_vs_mcap ?? 0;
  const p = config.scoring.factors.liquidity_depth_vs_mcap;
  if (!isOk(inputs.liquidityUsd) || !isOk(inputs.marketCapUsd)) {
    return unverifiedFactor("liquidity_depth_vs_mcap", weight, applied, "liquidity or market cap unavailable");
  }
  const liq = inputs.liquidityUsd.value;
  const mcap = inputs.marketCapUsd.value;
  if (liq === null || mcap === null || mcap <= 0) {
    return unverifiedFactor("liquidity_depth_vs_mcap", weight, applied, "liquidity or market cap unknown");
  }
  const ratio = liq / mcap;
  return scored("liquidity_depth_vs_mcap", weight, applied, ratio, lerpScore(ratio, p.full_score_ratio, p.zero_score_ratio), `liq/mcap=${ratio.toFixed(4)}`);
}

export function scoreVolumeVsMcap(inputs: RiskInputs, config: RiskConfig, applied: number): FactorScore {
  const weight = config.scoring.weights.volume_vs_mcap ?? 0;
  const p = config.scoring.factors.volume_vs_mcap;
  if (!isOk(inputs.volume24hUsd) || !isOk(inputs.marketCapUsd) || !isOk(inputs.ageHours)) {
    return unverifiedFactor("volume_vs_mcap", weight, applied, "volume, market cap or age unavailable");
  }
  const vol = inputs.volume24hUsd.value;
  const mcap = inputs.marketCapUsd.value;
  const age = inputs.ageHours.value;
  if (vol === null || mcap === null || mcap <= 0 || age === null) {
    return unverifiedFactor("volume_vs_mcap", weight, applied, "volume, market cap or age unknown");
  }
  const ratio = vol / mcap;
  const minRatio = age < p.young_hours ? p.young_min_ratio : p.mature_min_ratio;
  return scored("volume_vs_mcap", weight, applied, ratio, lerpScore(ratio, minRatio * 2, minRatio * 0.25), `vol/mcap=${ratio.toFixed(4)} age=${age.toFixed(1)}h`);
}

export function scoreHolderDistribution(inputs: RiskInputs, config: RiskConfig, applied: number): FactorScore {
  const weight = config.scoring.weights.holder_distribution ?? 0;
  const p = config.scoring.factors.holder_distribution;
  if (!isOk(inputs.top5Pct) || !isOk(inputs.top10Pct)) {
    return unverifiedFactor("holder_distribution", weight, applied, "top holder percents unavailable");
  }
  const top5 = inputs.top5Pct.value;
  const top10 = inputs.top10Pct.value;
  if (top5 === null || top10 === null) {
    return unverifiedFactor("holder_distribution", weight, applied, "top holder percents unknown");
  }
  const s5 = lerpScore(top5, p.top5_pct_full, p.top5_pct_zero);
  const s10 = lerpScore(top10, p.top10_pct_full, p.top10_pct_zero);
  const score = (s5 + s10) / 2;
  return scored("holder_distribution", weight, applied, top5, score, `top5=${top5}% top10=${top10}%`);
}

export function scoreDevBehavior(inputs: RiskInputs, config: RiskConfig, applied: number): FactorScore {
  const weight = config.scoring.weights.dev_behavior ?? 0;
  const p = config.scoring.factors.dev_behavior;
  if (!isOk(inputs.devBoughtMcapPct) || !isOk(inputs.devSold)) {
    return unverifiedFactor("dev_behavior", weight, applied, "dev buy/sell data unavailable");
  }
  const buyPct = inputs.devBoughtMcapPct.value;
  const sold = inputs.devSold.value;
  if (buyPct === null) return unverifiedFactor("dev_behavior", weight, applied, "dev buy percent unknown");
  let score = lerpScore(buyPct, 0, p.large_buy_mcap_pct);
  if (sold) score *= 1 - p.sell_penalty;
  return scored("dev_behavior", weight, applied, buyPct, clamp01(score), sold ? "dev sold after buying" : `dev buy ${buyPct}% of mcap`);
}

export function scoreChartAuthenticity(inputs: RiskInputs, config: RiskConfig, applied: number): FactorScore {
  const weight = config.scoring.weights.chart_authenticity ?? 0;
  if (!isOk(inputs.candles)) return unverifiedFactor("chart_authenticity", weight, applied, "candles unavailable");
  if (inputs.candles.value.length < 8) {
    return unverifiedFactor("chart_authenticity", weight, applied, "not enough candles");
  }
  const analysis = analyseChart(inputs.candles.value, config);
  return scored("chart_authenticity", weight, applied, analysis.score, analysis.score, `identical=${analysis.identicalShare.toFixed(2)} spike=${analysis.hugeCandleShare.toFixed(2)} stairs=${analysis.staircaseSteps}`);
}

/** Crowding penalty. Zero other coins scores 1. The config peer count scores 0. */
export function scoreNarrativeCrowding(inputs: RiskInputs, config: RiskConfig, applied: number): FactorScore {
  const weight = config.scoring.weights.narrative_crowding ?? 0;
  const p = config.scoring.factors.narrative_crowding;
  if (!isOk(inputs.sameNamePeers)) {
    return unverifiedFactor("narrative_crowding", weight, applied, "same-name count unavailable");
  }
  const peers = inputs.sameNamePeers.value;
  if (peers === null) {
    return unverifiedFactor("narrative_crowding", weight, applied, "name and symbol unknown");
  }
  const score = lerpScore(peers, p.full_score_peers, p.zero_score_peers);
  const detail = peers === 0 ? "no other coin shares this name or symbol" : `${peers} other coins share this name or symbol in ${p.window_hours}h`;
  return scored("narrative_crowding", weight, applied, peers, score, detail);
}

export function scoreFactors(inputs: RiskInputs, config: RiskConfig): FactorScore[] {
  const applied = effectiveWeights(config);
  const disabledSet = new Set(config.scoring.disabled_factors);
  const out: FactorScore[] = [];

  const run = (name: string, fn: (appliedWeight: number) => FactorScore) => {
    const weight = config.scoring.weights[name] ?? 0;
    if (disabledSet.has(name)) {
      out.push(disabled(name, weight));
      return;
    }
    out.push(fn(applied[name] ?? 0));
  };

  run("liquidity_depth_vs_mcap", (w) => scoreLiquidityDepth(inputs, config, w));
  run("volume_vs_mcap", (w) => scoreVolumeVsMcap(inputs, config, w));
  run("holder_distribution", (w) => scoreHolderDistribution(inputs, config, w));
  run("fees_paid_vs_mcap", () => disabled("fees_paid_vs_mcap", config.scoring.weights.fees_paid_vs_mcap ?? 0));
  run("dev_behavior", (w) => scoreDevBehavior(inputs, config, w));
  run("chart_authenticity", (w) => scoreChartAuthenticity(inputs, config, w));
  run("narrative_crowding", (w) => scoreNarrativeCrowding(inputs, config, w));
  run("social_legitimacy", () => disabled("social_legitimacy", config.scoring.weights.social_legitimacy ?? 0));
  return out;
}

export function combineScore(factors: FactorScore[]): { score: number | null; unverified: boolean } {
  const active = factors.filter((f) => !f.disabled);
  if (active.some((f) => f.unverified || f.score === null)) return { score: null, unverified: true };
  const totalWeight = active.reduce((s, f) => s + f.appliedWeight, 0);
  if (totalWeight <= 0) return { score: null, unverified: true };
  const weighted = active.reduce((s, f) => s + (f.score ?? 0) * f.appliedWeight, 0);
  return { score: Math.round((weighted / totalWeight) * 100), unverified: false };
}

export function scoreBand(score: number, config: RiskConfig): ScoreBand {
  if (score >= config.scoring.bands.lower_risk_min) return "LOWER_RISK";
  if (score >= config.scoring.bands.medium_min) return "MEDIUM";
  return "HIGH";
}
