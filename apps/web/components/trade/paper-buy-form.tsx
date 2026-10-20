"use client";

import { useEffect, useMemo, useState } from "react";
import { tradingConfig } from "@meme-guard/trading";
import type { QuotePreview } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/components/wallet/session-provider";
import { fmtPct, fmtPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const defaultLadder = tradingConfig.exit_plan.default_ladder.map((s) => ({ multiple: s.multiple, sellPct: s.sell_pct }));

export function PaperBuyForm({
  mint,
  symbol,
  priceChange1hPct,
  disabledReason,
}: {
  mint: string;
  symbol?: string | null;
  priceChange1hPct?: number | null;
  disabledReason?: string | null;
}) {
  const { me, refresh } = useSession();
  const [sizeSol, setSizeSol] = useState("1");
  const [thesis, setThesis] = useState("");
  const [sellReason, setSellReason] = useState("");
  const [stopPct, setStopPct] = useState(String(tradingConfig.exit_plan.default_stop_pct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [fomoAsk, setFomoAsk] = useState(false);
  const [fomoConfirmed, setFomoConfirmed] = useState(false);

  const thesisOk = thesis.trim().length >= tradingConfig.discipline.min_thesis_chars;
  const sellOk = sellReason.trim().length >= tradingConfig.discipline.min_sell_reason_chars;
  const size = Number(sizeSol);
  const ready = thesisOk && sellOk && size > 0 && !disabledReason;
  const gateHint = disabledReason
    ? disabledReason
    : !thesisOk
      ? `Why you are buying needs at least ${tradingConfig.discipline.min_thesis_chars} characters.`
      : !sellOk
        ? `What would make you sell needs at least ${tradingConfig.discipline.min_sell_reason_chars} characters.`
        : !(size > 0)
          ? "Enter a SOL size above zero."
          : null;

  useEffect(() => {
    if (!me || !ready) return;
    const id = setInterval(() => {
      void api
        .tradePreview({ mint, side: "buy", sizeSol: size, fomoConfirmed })
        .then(setPreview)
        .catch(() => undefined);
    }, 8000);
    void api.tradePreview({ mint, side: "buy", sizeSol: size, fomoConfirmed }).then(setPreview).catch(() => undefined);
    return () => clearInterval(id);
  }, [me, mint, size, ready, fomoConfirmed]);

  const fomo = useMemo(() => {
    const ch = priceChange1hPct ?? preview?.fomo;
    return typeof ch === "number" ? ch >= tradingConfig.discipline.fomo_1h_change_pct : Boolean(preview?.fomo);
  }, [priceChange1hPct, preview]);

  async function submit(confirmed = fomoConfirmed) {
    if (!me) return;
    if (fomo && !confirmed) {
      setFomoAsk(true);
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api.paperBuy({
        mint,
        sizeSol: size,
        thesis: thesis.trim(),
        sellReason: sellReason.trim(),
        stopPct: Number(stopPct) || tradingConfig.exit_plan.default_stop_pct,
        ladder: defaultLadder,
        fomoConfirmed: confirmed,
      });
      setOk("Paper buy filled at the live quote. Risk-reduced, not safe.");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Buy failed");
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <Card><CardContent className="text-sm text-muted-foreground">Connect a wallet and sign in to paper trade. Meme Guard never asks for a seed phrase.</CardContent></Card>;
  }
  if (disabledReason) {
    return <Card><CardContent className="text-sm text-muted-foreground">{disabledReason}</CardContent></Card>;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Paper buy {symbol ?? ""}</CardTitle>
          <span className="font-mono text-[11px] text-muted-foreground">{me.paperBalanceSol.toFixed(3)} SOL virtual</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
      <label className="text-xs text-muted-foreground">
        Size (SOL)
        <Input
          type="number"
          min={0.01}
          step="0.01"
          value={sizeSol}
          onChange={(e) => setSizeSol(e.target.value)}
          className="mt-1"
        />
      </label>
      <label className="text-xs text-muted-foreground">
        Why I am buying
        <Textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} className="mt-1" />
      </label>
      <label className="text-xs text-muted-foreground">
        What would make me sell
        <Textarea value={sellReason} onChange={(e) => setSellReason(e.target.value)} rows={2} className="mt-1" />
      </label>
      <label className="text-xs text-muted-foreground">
        Stop-loss %
        <Input type="number" min={1} max={90} value={stopPct} onChange={(e) => setStopPct(e.target.value)} className="mt-1 w-28" />
      </label>
      <p className="text-[11px] text-muted-foreground">
        Default scale-out: 30% at 2x, 30% at 3x, 40% at 5x. Stops on thin liquidity can slip or fail. Passing filters is risk-reduced, not safe.
      </p>
      {preview?.fillPriceSol ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          Quote {fmtPrice(preview.fillPriceSol)} SOL/token · impact {fmtPct(preview.priceImpactPct)} · out {preview.expectedOut?.toPrecision(6)}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {ok ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{ok}</p> : null}
      {gateHint ? <p className="text-xs text-muted-foreground">{gateHint}</p> : null}
      <Button type="submit" disabled={!ready || busy}>
        {busy ? "Filling…" : "Paper buy"}
      </Button>

      {fomoAsk ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-100">
          <p>This coin is already up a large percentage in the last hour. Would you still buy at this price with no chart in front of you?</p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setFomoConfirmed(true);
                setFomoAsk(false);
                void submit(true);
              }}
            >
              Yes, still buy
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setFomoAsk(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
        </CardContent>
      </Card>
    </form>
  );
}
