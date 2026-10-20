export function isLiquidityCollapsed(peakUsd: number | null, latestUsd: number | null, dropPct = 90): boolean {
  if (peakUsd === null || latestUsd === null || peakUsd <= 0) return false;
  return ((peakUsd - latestUsd) / peakUsd) * 100 >= dropPct;
}

export function nextPeak(currentPeak: number | null, latestUsd: number | null): number | null {
  if (latestUsd === null) return currentPeak;
  if (currentPeak === null) return latestUsd;
  return Math.max(currentPeak, latestUsd);
}

export function creatorRugCount(opts: { recordedRugs: number; ruggedFlag: boolean; collapsedHere: boolean }): number {
  let n = opts.recordedRugs;
  if (opts.ruggedFlag) n = Math.max(n, 1);
  if (opts.collapsedHere) n = Math.max(n, opts.recordedRugs + 1, opts.ruggedFlag ? 1 : 0);
  return n;
}
