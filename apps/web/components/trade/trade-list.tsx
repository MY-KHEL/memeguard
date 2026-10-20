"use client";

import Link from "next/link";
import type { TradeCandidate, Verdict } from "@meme-guard/shared-types";
import { VerdictBadge } from "@/components/verdict-badge";
import { PaperBuyForm } from "@/components/trade/paper-buy-form";
import { Card } from "@/components/ui/card";
import { fmtUsd } from "@/lib/format";
import { useLiveToken, useWatchMintsStable } from "@/lib/live";

export function TradeList({ items }: { items: TradeCandidate[] }) {
  useWatchMintsStable(items.map((c) => c.mint));
  return (
    <ul className="flex flex-col gap-4">
      {items.map((c) => (
        <TradeRow key={c.mint} candidate={c} />
      ))}
    </ul>
  );
}

function TradeRow({ candidate }: { candidate: TradeCandidate }) {
  const c = useLiveToken(candidate);
  const liveVerdict = (c as TradeCandidate & { verdict?: Verdict }).verdict;
  const tradable = liveVerdict !== "BLOCKED" && liveVerdict !== "UNVERIFIED";
  return (
    <li>
      <Card size="sm" className="gap-3">
      <div className="flex items-center gap-3">
        <Link href={`/explore/${c.mint}`} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
          {c.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.imageUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="inline-block h-8 w-8 rounded-full bg-black/10 dark:bg-white/10" />
          )}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {c.symbol ?? c.mint.slice(0, 6)}
              <VerdictBadge verdict={liveVerdict ?? "PASS"} score={c.score} />
              <span className="font-mono text-[11px] text-muted-foreground">{(c.band ?? "MEDIUM").replace("_", " ")}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">{c.summary}</p>
          </div>
        </Link>
        <div className="hidden text-right font-mono text-xs text-muted-foreground sm:block">
          <p>mcap {fmtUsd(c.marketCapUsd)}</p>
          <p>1h {fmtUsd(c.volume1hUsd)} · 24h {fmtUsd(c.volume24hUsd)}</p>
          <p>liq {fmtUsd(c.liquidityUsd)}</p>
        </div>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground sm:hidden">
        mcap {fmtUsd(c.marketCapUsd)} · 1h {fmtUsd(c.volume1hUsd)} · 24h {fmtUsd(c.volume24hUsd)}
      </p>
      <div className="mt-3">
        {tradable ? (
          <PaperBuyForm mint={c.mint} symbol={c.symbol} />
        ) : (
          <p className="text-xs text-muted-foreground">Verdict flipped to {liveVerdict}. Not tradable.</p>
        )}
      </div>
      </Card>
    </li>
  );
}
