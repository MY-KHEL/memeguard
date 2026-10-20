"use client";

import type { Verdict } from "@meme-guard/shared-types";
import { PaperBuyForm } from "@/components/trade/paper-buy-form";
import { VerdictBadge } from "@/components/verdict-badge";
import { useLiveToken, useWatchMintsStable } from "@/lib/live";

export function LiveVerdictBadge({
  mint,
  verdict,
  score,
}: {
  mint: string;
  verdict: Verdict;
  score: number | null;
}) {
  useWatchMintsStable([mint]);
  const live = useLiveToken({ mint, verdict, score });
  return <VerdictBadge verdict={live.verdict ?? verdict} score={live.score} />;
}

export function LiveTradeGate({
  mint,
  symbol,
  verdict,
  priceChange1hPct,
}: {
  mint: string;
  symbol: string | null;
  verdict: Verdict;
  priceChange1hPct: number | null;
}) {
  useWatchMintsStable([mint]);
  const live = useLiveToken({ mint, verdict, priceChange1hPct });
  const current = live.verdict ?? verdict;
  return (
    <>
      <p className="rounded-2xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground ring-1 ring-foreground/10">
        {current === "UNVERIFIED"
          ? "This coin is UNVERIFIED: a source was missing or it has not been evaluated yet. Unverified coins are never tradable here."
          : current === "BLOCKED"
            ? "This coin is BLOCKED by a hard filter. It stays visible so you can learn from it, but it is never tradable here."
            : "This coin passed the hard filters. That is risk-reduced, not safe."}
      </p>
      {current === "PASS" ? (
        <PaperBuyForm mint={mint} symbol={symbol} priceChange1hPct={priceChange1hPct} />
      ) : (
        <PaperBuyForm
          mint={mint}
          symbol={symbol}
          disabledReason={current === "BLOCKED" ? "BLOCKED coins have no buy button." : "UNVERIFIED coins are never tradable."}
        />
      )}
    </>
  );
}
