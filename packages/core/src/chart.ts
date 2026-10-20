import type { RiskConfig } from "./config";
import type { CandleInput } from "./types";

export function candleBody(c: CandleInput): number {
  return Math.abs(c.close - c.open);
}

export function upOnlyRatio(candles: CandleInput[]): number {
  if (candles.length === 0) return 0;
  const up = candles.filter((c) => c.close >= c.open).length;
  return up / candles.length;
}

export interface ChartAuthenticity {
  identicalShare: number;
  hugeCandleShare: number;
  staircaseSteps: number;
  /** 1 is authentic; 0 is the most fabricated-looking. */
  score: number;
}

/**
 * Near-identical candle bodies, one-candle spikes, and long monotonic
 * staircases are the three patterns named in docs/SPEC.md section 6.2.
 */
export function analyseChart(candles: CandleInput[], config: RiskConfig): ChartAuthenticity {
  const params = config.scoring.factors.chart_authenticity;
  if (candles.length < 2) {
    return { identicalShare: 0, hugeCandleShare: 0, staircaseSteps: 0, score: 1 };
  }

  const bodies = candles.map(candleBody);
  const maxBody = Math.max(...bodies, 0);
  const meanBody = bodies.reduce((s, b) => s + b, 0) / bodies.length;

  let identicalPairs = 0;
  for (let i = 1; i < bodies.length; i++) {
    const a = bodies[i - 1] ?? 0;
    const b = bodies[i] ?? 0;
    const denom = Math.max(a, b, 1e-12);
    if ((Math.abs(a - b) / denom) * 100 <= params.identical_body_tolerance_pct) identicalPairs += 1;
  }
  const identicalShare = identicalPairs / (bodies.length - 1);
  const hugeCandleShare = maxBody > 0 ? maxBody / bodies.reduce((s, b) => s + b, 0) : 0;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    const sameDir = (cur.close - cur.open) * (prev.close - prev.open) > 0 && candleBody(cur) > 0;
    const smallOverlap = Math.abs(cur.open - prev.close) <= Math.max(meanBody * 0.25, 1e-12);
    if (sameDir && smallOverlap) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  const identicalPenalty = clamp01((identicalShare - params.identical_share_warn) / (1 - params.identical_share_warn || 1));
  const spikePenalty = clamp01((hugeCandleShare - params.huge_candle_share_warn) / (1 - params.huge_candle_share_warn || 1));
  const stairPenalty = longest >= params.staircase_min_steps ? clamp01((longest - params.staircase_min_steps + 1) / params.staircase_min_steps) : 0;
  const score = clamp01(1 - 0.45 * identicalPenalty - 0.35 * spikePenalty - 0.2 * stairPenalty);

  return { identicalShare, hugeCandleShare, staircaseSteps: longest, score };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
