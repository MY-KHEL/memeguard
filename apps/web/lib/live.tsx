"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { marketCapFromClose } from "@meme-guard/providers/candles";
import { cn } from "@/lib/utils";
import type { CandleTimeframe, LiveEvent, Regime, ScoreBand, TokenCandle, TokenStats, TokenTick, Verdict } from "@meme-guard/shared-types";

type TickMap = Record<string, TokenTick>;
type CandleMap = Record<string, TokenCandle>;
type StatsMap = Record<string, TokenStats>;
type VerdictMap = Record<string, { verdict: Verdict; score: number | null; band: ScoreBand | null; ts: string }>;
type ChartWatch = { mint: string; tf: CandleTimeframe } | null;

interface LiveState {
  connected: boolean;
  ticks: TickMap;
  candles: CandleMap;
  coinStats: StatsMap;
  verdicts: VerdictMap;
  lastHeartbeat: string | null;
  positionRev: number;
  notifRev: number;
  verdictRev: number;
  regime: Regime | null;
  birdeyeChartMint: string | null;
}

const LiveContext = createContext<
  LiveState & {
    chartTf: CandleTimeframe | null;
    watch: (mints: string[]) => void;
    watchChart: (next: ChartWatch) => void;
    setBirdeyeChart: (mint: string | null) => void;
  }
>({
  connected: false,
  ticks: {},
  candles: {},
  coinStats: {},
  verdicts: {},
  lastHeartbeat: null,
  positionRev: 0,
  notifRev: 0,
  verdictRev: 0,
  regime: null,
  birdeyeChartMint: null,
  chartTf: null,
  watch: () => undefined,
  watchChart: () => undefined,
  setBirdeyeChart: () => undefined,
});

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({
    connected: false,
    ticks: {},
    candles: {},
    coinStats: {},
    verdicts: {},
    lastHeartbeat: null,
    positionRev: 0,
    notifRev: 0,
    verdictRev: 0,
    regime: null,
    birdeyeChartMint: null,
  });
  const [mints, setMints] = useState<string[]>([]);
  const [chartMint, setChartMint] = useState<string | null>(null);
  const [chartTf, setChartTf] = useState<CandleTimeframe | null>(null);
  const watch = (next: string[]) => {
    const key = [...new Set(next)].sort().join(",");
    setMints((prev) => (prev.join(",") === key ? prev : key.split(",").filter(Boolean)));
  };
  const watchChart = useCallback((next: ChartWatch) => {
    setChartMint(next?.mint ?? null);
    setChartTf(next?.tf ?? null);
  }, []);
  const setBirdeyeChart = useCallback((mint: string | null) => {
    setState((s) => (s.birdeyeChartMint === mint ? s : { ...s, birdeyeChartMint: mint }));
  }, []);

  const mintKey = mints.join(",");
  useEffect(() => {
    const params = new URLSearchParams();
    if (mintKey) params.set("mints", mintKey);
    if (chartMint && chartTf) {
      params.set("chart", chartMint);
      params.set("tf", chartTf);
    }
    const qs = params.toString();
    const es = new EventSource(qs ? `/api/stream?${qs}` : "/api/stream");
    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as LiveEvent;
        if (data.type === "heartbeat") {
          setState((s) => ({ ...s, connected: true, lastHeartbeat: data.ts }));
          return;
        }
        if (data.type === "token.tick") {
          setState((s) => ({ ...s, ticks: { ...s.ticks, [data.mint]: data } }));
          return;
        }
        if (data.type === "token.candle") {
          setState((s) => ({ ...s, candles: { ...s.candles, [data.mint]: data } }));
          return;
        }
        if (data.type === "token.stats") {
          setState((s) => ({ ...s, coinStats: { ...s.coinStats, [data.mint]: data } }));
          return;
        }
        if (data.type === "token.verdict") {
          setState((s) => ({
            ...s,
            verdictRev: s.verdictRev + 1,
            verdicts: { ...s.verdicts, [data.mint]: { verdict: data.verdict, score: data.score, band: data.band, ts: data.ts } },
          }));
          return;
        }
        if (data.type === "position.update") {
          setState((s) => ({ ...s, positionRev: s.positionRev + 1 }));
          return;
        }
        if (data.type === "regime.update") {
          setState((s) => ({ ...s, regime: data.regime }));
          return;
        }
        if (data.type === "notification.new") {
          setState((s) => ({ ...s, notifRev: s.notifRev + 1 }));
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, [mintKey, chartMint, chartTf]);

  const value = useMemo(
    () => ({ ...state, chartTf, watch, watchChart, setBirdeyeChart }),
    [state, chartTf, watchChart, setBirdeyeChart],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  return useContext(LiveContext);
}

export function useWatchMints(mints: string[]) {
  const { watch } = useLive();
  const key = mints.join(",");
  useEffect(() => {
    watch(key.split(",").filter(Boolean));
  }, [key, watch]);
}

export function useLiveToken<
  T extends {
    mint: string;
    priceUsd?: number | null;
    marketCapUsd?: number | null;
    liquidityUsd?: number | null;
    volume24hUsd?: number | null;
    priceChange1hPct?: number | null;
    verdict?: Verdict;
    riskScore?: number | null;
    score?: number | null;
    band?: ScoreBand | null;
  },
>(token: T): T {
  const { ticks, verdicts, candles, coinStats, birdeyeChartMint, chartTf } = useLive();
  const tick = ticks[token.mint];
  const verdict = verdicts[token.mint];
  const candle = candles[token.mint];
  const stats = coinStats[token.mint];
  const liveCandle = birdeyeChartMint === token.mint && chartTf && candle?.timeframe === chartTf ? candle : null;
  if (!tick && !verdict && !liveCandle) return token;
  const verdictFields = verdict
    ? {
        verdict: verdict.verdict,
        riskScore: verdict.score,
        score: verdict.score ?? token.score,
        band: verdict.band ?? token.band,
      }
    : {};
  if (liveCandle) {
    const derivedCap = marketCapFromClose(liveCandle.close, stats?.circulatingSupply);
    return {
      ...token,
      ...verdictFields,
      priceUsd: liveCandle.close,
      marketCapUsd: derivedCap ?? token.marketCapUsd ?? null,
      liquidityUsd: stats?.liquidityUsd ?? token.liquidityUsd ?? null,
      volume24hUsd: stats?.volume24hUsd ?? token.volume24hUsd ?? null,
      priceChange1hPct: stats?.priceChange1hPct ?? token.priceChange1hPct ?? null,
    };
  }
  return {
    ...token,
    priceUsd: tick?.priceUsd ?? token.priceUsd ?? null,
    marketCapUsd: tick?.marketCapUsd ?? token.marketCapUsd ?? null,
    liquidityUsd: tick?.liquidityUsd ?? token.liquidityUsd ?? null,
    volume24hUsd: tick?.volume24hUsd ?? token.volume24hUsd ?? null,
    priceChange1hPct: tick?.priceChange1hPct ?? token.priceChange1hPct ?? null,
    ...(verdict
      ? {
          verdict: verdict.verdict,
          riskScore: verdict.score,
          score: verdict.score ?? token.score,
          band: verdict.band ?? token.band,
        }
      : {}),
  };
}

export function LiveStatus({ className }: { className?: string }) {
  const { connected } = useLive();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] tracking-wide",
        connected ? "text-primary" : "text-muted-foreground",
        className,
      )}
    >
      <span className={`size-1.5 rounded-full ${connected ? "bg-primary" : "bg-muted-foreground/60"}`} aria-hidden />
      {connected ? "Live" : "Feed paused"}
    </span>
  );
}

/** Keep a stable watch callback identity so consumers do not loop. */
export function useWatchMintsStable(mints: string[]) {
  const { watch } = useLive();
  const prev = useRef("");
  useEffect(() => {
    const key = [...new Set(mints)].sort().join(",");
    if (key === prev.current) return;
    prev.current = key;
    watch(mints);
  }, [mints, watch]);
}
