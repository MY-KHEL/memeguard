import type { Regime } from "@meme-guard/shared-types";
import { riskConfig, type RiskConfig } from "./config";

export type MajorTrend = "up" | "down" | "flat";

export interface DailyBar {
  high: number;
  low: number;
}

export interface RegimeInput {
  btc: MajorTrend;
  eth: MajorTrend;
  sol: MajorTrend;
  /** Current memecoin volume / previous window. Null when we have no baseline. */
  volumeRatio: number | null;
  avgPeakMcap: number | null;
}

export interface RegimeDecision {
  regime: Regime;
  btcTrend: MajorTrend;
  ethTrend: MajorTrend;
  solTrend: MajorTrend;
  volumeRatio: number | null;
  avgPeakMcap: number | null;
  upCount: number;
  downCount: number;
}

/**
 * Higher highs and higher lows on the last N consecutive pairs → up.
 * Lower highs and lower lows → down. Anything else is flat, including
 * too few bars (fail closed for HOT/COLD, caller treats as NEUTRAL).
 */
export function trendFromDaily(bars: DailyBar[], minPairs: number): MajorTrend {
  if (minPairs < 1 || bars.length < minPairs + 1) return "flat";
  const recent = bars.slice(-(minPairs + 1));
  let hh = 0;
  let hl = 0;
  let lh = 0;
  let ll = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]!;
    const cur = recent[i]!;
    if (cur.high > prev.high) hh += 1;
    if (cur.high < prev.high) lh += 1;
    if (cur.low > prev.low) hl += 1;
    if (cur.low < prev.low) ll += 1;
  }
  if (hh >= minPairs && hl >= minPairs) return "up";
  if (lh >= minPairs && ll >= minPairs) return "down";
  return "flat";
}

/** Collapse intra-day OHLC rows onto UTC calendar days. */
export function dailyBarsFromOhlc(
  rows: Array<{ timeMs: number; open: number; high: number; low: number; close: number }>,
): DailyBar[] {
  const byDay = new Map<string, DailyBar>();
  const order: string[] = [];
  for (const row of rows) {
    const key = new Date(row.timeMs).toISOString().slice(0, 10);
    const existing = byDay.get(key);
    if (!existing) {
      byDay.set(key, { high: row.high, low: row.low });
      order.push(key);
    } else {
      existing.high = Math.max(existing.high, row.high);
      existing.low = Math.min(existing.low, row.low);
    }
  }
  return order.map((k) => byDay.get(k)!);
}

export function classifyRegime(input: RegimeInput, config: RiskConfig = riskConfig): RegimeDecision {
  const majors = [input.btc, input.eth, input.sol];
  const upCount = majors.filter((t) => t === "up").length;
  const downCount = majors.filter((t) => t === "down").length;
  const r = config.regime;
  const volumeHot = input.volumeRatio !== null && input.volumeRatio >= r.volume_hot_ratio;
  const volumeCold = input.volumeRatio !== null && input.volumeRatio <= r.volume_cold_ratio;
  const peakHot = input.avgPeakMcap !== null && input.avgPeakMcap >= r.peak_mcap_hot_usd;
  const peakCold = input.avgPeakMcap !== null && input.avgPeakMcap <= r.peak_mcap_cold_usd;

  let regime: Regime = "NEUTRAL";
  if (upCount >= r.majors_up_for_hot && (volumeHot || peakHot)) regime = "HOT";
  else if (downCount >= r.majors_down_for_cold || (volumeCold && peakCold)) regime = "COLD";

  return {
    regime,
    btcTrend: input.btc,
    ethTrend: input.eth,
    solTrend: input.sol,
    volumeRatio: input.volumeRatio,
    avgPeakMcap: input.avgPeakMcap,
    upCount,
    downCount,
  };
}

export function isRugged(base: number | null, later: number | null, dropPct: number): boolean {
  if (base === null || later === null || !(base > 0) || !Number.isFinite(later)) return false;
  return ((base - later) / base) * 100 >= dropPct;
}
