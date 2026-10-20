"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PortfolioResponse } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/components/wallet/session-provider";
import { useLive, useWatchMintsStable } from "@/lib/live";
import { fmtPct, fmtUsd, shortAddress } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function PortfolioClient() {
  const { me } = useSession();
  const { positionRev, ticks } = useLive();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    void api
      .portfolio()
      .then((p) => {
        setData(p);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load portfolio"));
  }, [me, positionRev]);

  useWatchMintsStable(data?.open.map((p) => p.mint) ?? []);

  if (!me) return <p className="text-sm text-muted-foreground">Sign in to see paper positions. No seed phrase is ever requested.</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading portfolio…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Paper cash" value={`${data.paperBalanceSol.toFixed(3)} SOL`} />
        <Stat label="Equity" value={`${data.equitySol.toFixed(3)} SOL`} />
        <Stat label="Exposure" value={`${data.exposureSol.toFixed(3)} SOL`} />
        <Stat
          label="Limits"
          value={data.dailyLossLocked ? "Daily loss lock" : data.cooldownUntil ? "Cooldown" : `${data.limits.maxPctPerCoin}% / ${data.limits.maxOpenPositions} open`}
        />
      </div>
      {data.dailyLossLocked ? (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-950/40">
          Daily-loss lock is on. New paper buys are blocked until the next UTC day.
        </p>
      ) : null}

      {data.open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open paper positions.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.open.map((p) => {
            const tick = ticks[p.mint];
            const px = tick?.priceUsd ?? p.markPriceUsd;
            return (
              <li key={p.id}>
                <Card size="sm">
                <CardContent className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/explore/${p.mint}`} className="font-medium hover:underline">
                    {p.symbol ?? shortAddress(p.mint)}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">mark {fmtUsd(px)} · uPnL {p.unrealizedPnlSol?.toFixed(3) ?? "—"} SOL ({fmtPct(p.unrealizedPct)})</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Thesis: {p.thesis}</p>
                {p.stopHit ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Stop level hit. Stops on thin liquidity can slip or fail.</p>
                ) : null}
                {p.ladderHits.length ? <p className="mt-1 text-xs text-muted-foreground">Ladder hit: {p.ladderHits.map((m) => `${m}x`).join(", ")}</p> : null}
                {p.recheck ? (
                  <div className="mt-2 rounded-md bg-black/[0.03] p-2 text-xs dark:bg-white/[0.04]">
                    This position is up substantially. Would you buy it now at this price?
                    <button type="button" className="ml-2 underline" onClick={() => void api.ackRecheck(p.id).then(() => api.portfolio().then(setData))}>
                      Acknowledged
                    </button>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === p.id}
                  className="mt-2"
                  onClick={() => {
                    setBusyId(p.id);
                    void api
                      .paperSell({ positionId: p.id, close: true })
                      .then(() => api.portfolio().then(setData))
                      .finally(() => setBusyId(null));
                  }}
                >
                  {busyId === p.id ? "Selling…" : "Close paper"}
                </Button>
                </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm">{value}</p>
      </CardContent>
    </Card>
  );
}
