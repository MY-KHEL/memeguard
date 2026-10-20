"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { applyLiveCandle, applyTickToCandles, TIMEFRAME_SECONDS } from "@meme-guard/providers/candles";
import { CANDLE_TIMEFRAMES, type CandleTimeframe, type CandlesResponse } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { useLive, useWatchMintsStable } from "@/lib/live";
import { ProviderNotice } from "./provider-notice";

const CandleChart = dynamic(() => import("./candle-chart"), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded bg-black/5 dark:bg-white/5" />,
});

const REFRESH_MS = 30_000;

type State = { kind: "loading" } | { kind: "ready"; res: CandlesResponse } | { kind: "error"; message: string };

export function CandlesPanel({ mint }: { mint: string }) {
  const [tf, setTf] = useState<CandleTimeframe>("1m");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const { ticks, candles, watchChart, setBirdeyeChart } = useLive();
  useWatchMintsStable([mint]);
  const live = ticks[mint];
  const liveRef = useRef(live);
  liveRef.current = live;
  const bar = candles[mint];
  const barRef = useRef(bar);
  barRef.current = bar;

  useEffect(() => {
    watchChart({ mint, tf });
    return () => watchChart(null);
  }, [mint, tf, watchChart]);

  function paintLive(res: CandlesResponse): CandlesResponse {
    if (!res.ok) return res;
    if (res.source === "birdeye") {
      const current = barRef.current;
      if (!current || current.timeframe !== tf) return res;
      const data = applyLiveCandle(res.data, {
        time: current.time,
        open: current.open,
        high: current.high,
        low: current.low,
        close: current.close,
        volume: current.volume,
      });
      return data === res.data ? res : { ...res, data };
    }
    const current = liveRef.current;
    const price = current?.priceUsd;
    if (!current || price == null) return res;
    const nowSec = Math.floor(Date.parse(current.ts) / 1000);
    const data = applyTickToCandles(res.data, price, nowSec, TIMEFRAME_SECONDS[tf]);
    return data === res.data ? res : { ...res, data };
  }

  useEffect(() => {
    const controller = new AbortController();
    api
      .candles(mint, tf, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setState({ kind: "ready", res: paintLive(res) });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load candles" });
      });
    return () => controller.abort();
  }, [mint, tf, tick]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const historyReady = state.kind === "ready" && state.res.ok;
  const historySource = historyReady && state.kind === "ready" && state.res.ok ? state.res.source : null;
  useEffect(() => {
    setBirdeyeChart(historySource === "birdeye" ? mint : null);
    return () => setBirdeyeChart(null);
  }, [historySource, mint, setBirdeyeChart]);

  useEffect(() => {
    if (!bar || bar.timeframe !== tf || historySource !== "birdeye") return;
    setState((s) => {
      if (s.kind !== "ready" || !s.res.ok || s.res.source !== "birdeye") return s;
      const data = applyLiveCandle(s.res.data, {
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
      if (data === s.res.data) return s;
      return { kind: "ready", res: { ...s.res, data } };
    });
  }, [bar, tf, historySource]);

  useEffect(() => {
    const price = live?.priceUsd;
    if (!live || price == null || historySource === null || historySource === "birdeye") return;
    const nowSec = Math.floor(Date.parse(live.ts) / 1000);
    setState((s) => {
      if (s.kind !== "ready" || !s.res.ok || s.res.source === "birdeye") return s;
      const data = applyTickToCandles(s.res.data, price, nowSec, TIMEFRAME_SECONDS[tf]);
      if (data === s.res.data) return s;
      return { kind: "ready", res: { ...s.res, data } };
    });
  }, [live?.priceUsd, live?.ts, tf, historySource]);

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Price</h2>
        <div className="flex items-center gap-1" role="tablist" aria-label="Timeframe">
          {CANDLE_TIMEFRAMES.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tf}
              type="button"
              onClick={() => setTf(t)}
              className={`min-h-8 rounded-lg px-2 py-1 font-mono text-xs ${t === tf ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="h-[360px] animate-pulse rounded bg-black/5 dark:bg-white/5" />
      ) : state.kind === "error" ? (
        <ProviderNotice title="Chart unavailable" detail={state.message} onRetry={() => setTick((n) => n + 1)} />
      ) : !state.res.ok ? (
        <ProviderNotice
          title="Chart unavailable"
          detail={describeReason(state.res.reason, state.res.source, state.res.error)}
          onRetry={() => setTick((n) => n + 1)}
        />
      ) : state.res.data.length === 0 ? (
        <ProviderNotice title="No candles yet" detail={`${state.res.source} has no ${tf} history for this pair yet. Try a smaller timeframe or check back shortly.`} />
      ) : (
        <>
          <CandleChart candles={state.res.data} secondsVisible={tf === "1m"} />
          <p className="mt-2 text-right font-mono text-[11px] text-muted-foreground">
            {state.res.data.length} candles · {state.res.source}
            {state.res.fromCache ? " · cached" : ""} · {new Date(state.res.fetchedAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </section>
  );
}

export function describeReason(reason: string, source: string, error?: string): string {
  switch (reason) {
    case "not_configured":
      return `${source} is not configured on this server (API key missing). Data from this source is treated as unverified.`;
    case "rate_limited":
      return `${source} rate limit reached. Retrying automatically.`;
    case "timeout":
      return `${source} timed out.`;
    case "not_found":
      return `${source} has no record of this token or pair.`;
    case "invalid_response":
      return `${source} returned an unexpected response${error ? `: ${error}` : ""}.`;
    default:
      return `${source} is unavailable${error ? `: ${error}` : ""}.`;
  }
}
