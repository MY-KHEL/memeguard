"use client";

import { useEffect, useState } from "react";
import type { RegimeSnapshotDto } from "@meme-guard/shared-types";
import { tradingConfig } from "@meme-guard/trading";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/live";

export function RegimeBanner() {
  const { regime: live } = useLive();
  const [snap, setSnap] = useState<RegimeSnapshotDto | null>(null);

  useEffect(() => {
    void api.regime().then(setSnap).catch(() => undefined);
  }, []);

  const regime = live ?? snap?.regime ?? "NEUTRAL";
  const cold = regime === "COLD";
  const hot = regime === "HOT";
  const tone = cold
    ? "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
    : hot
      ? "border-primary/30 bg-accent text-accent-foreground"
      : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div className={`border-b px-4 py-2 text-xs sm:px-6 ${tone}`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
        <p>
          Market regime <span className="font-semibold">{regime}</span>
          {snap ? ` · BTC ${snap.btcTrend ?? "—"} · ETH ${snap.ethTrend ?? "—"} · SOL ${snap.solTrend ?? "—"}` : null}
        </p>
        {cold ? (
          <p>
            Size caps are reduced to {Math.round(tradingConfig.regime.cold_size_multiplier * 100)}% of your settings. You can still paper-trade inside the tighter limits.
          </p>
        ) : (
          <p className="text-muted-foreground">Risk-reduced, not risk-free. Regime updates within the hour.</p>
        )}
      </div>
    </div>
  );
}
