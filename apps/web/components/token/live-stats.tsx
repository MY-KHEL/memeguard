"use client";

import { useWatchMintsStable, useLiveToken } from "@/lib/live";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";

function useLiveMarket(mint: string, seed: { priceUsd: number | null; marketCapUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; priceChange1hPct: number | null }) {
  useWatchMintsStable([mint]);
  return useLiveToken({ mint, ...seed });
}

export function LivePrice({
  mint,
  priceUsd,
  marketCapUsd,
  liquidityUsd,
  volume24hUsd,
  priceChange1hPct,
}: {
  mint: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange1hPct: number | null;
}) {
  const live = useLiveMarket(mint, { priceUsd, marketCapUsd, liquidityUsd, volume24hUsd, priceChange1hPct });
  const change = live.priceChange1hPct ?? null;
  const changeClass = change === null ? "text-muted-foreground" : change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div className="text-right">
      <p className="font-mono text-2xl">{fmtPrice(live.priceUsd ?? null)}</p>
      <p className={`font-mono text-sm ${changeClass}`}>{fmtPct(change)} 1h</p>
    </div>
  );
}

export function LiveMarket({
  mint,
  priceUsd,
  marketCapUsd,
  liquidityUsd,
  volume24hUsd,
  priceChange1hPct,
}: {
  mint: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange1hPct: number | null;
}) {
  const live = useLiveMarket(mint, { priceUsd, marketCapUsd, liquidityUsd, volume24hUsd, priceChange1hPct });
  return (
    <>
      <Stat label="Market cap" value={fmtUsd(live.marketCapUsd ?? null)} />
      <Stat label="Liquidity" value={fmtUsd(live.liquidityUsd ?? null)} />
      <Stat label="Volume 24h" value={fmtUsd(live.volume24hUsd ?? null)} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm">{value}</p>
    </div>
  );
}
