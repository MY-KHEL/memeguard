"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@meme-guard/shared-types";
import { fmtPrice } from "@/lib/format";

function toPrice(c: Candle) {
  return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}

function toVolume(c: Candle) {
  return {
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)",
  };
}

function lastBarOnly(prev: Candle[], next: Candle[]): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  if (next.length !== prev.length && next.length !== prev.length + 1) return false;
  const limit = Math.min(prev.length, next.length) - (next.length === prev.length ? 1 : 0);
  for (let i = 0; i < limit; i++) {
    const a = prev[i]!;
    const b = next[i]!;
    if (a.time !== b.time || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || a.volume !== b.volume) {
      return false;
    }
  }
  return true;
}

/**
 * Candlestick + volume chart. Loaded with next/dynamic (ssr: false) because
 * lightweight-charts needs a real DOM. History replaces via setData; live
 * ticks only update the last bar.
 */
export default function CandleChart({
  candles,
  height = 360,
  secondsVisible = false,
}: {
  candles: Candle[];
  height?: number;
  secondsVisible?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const prevRef = useRef<Candle[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const text = dark ? "#a1a1aa" : "#52525b";
    const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text, attributionLogo: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: { type: "custom", formatter: (p: number) => fmtPrice(p), minMove: 1e-12 },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: dark ? "rgba(161,161,170,0.35)" : "rgba(82,82,91,0.35)",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    priceRef.current = priceSeries;
    volumeRef.current = volumeSeries;
    prevRef.current = [];

    return () => {
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volumeRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible } });
  }, [secondsVisible]);

  useEffect(() => {
    const price = priceRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!price || !volume || !chart) return;

    const prev = prevRef.current;
    const last = candles[candles.length - 1];
    if (last && lastBarOnly(prev, candles)) {
      price.update(toPrice(last));
      volume.update(toVolume(last));
    } else {
      price.setData(candles.map(toPrice));
      volume.setData(candles.map(toVolume));
      chart.timeScale().fitContent();
    }
    prevRef.current = candles;
  }, [candles]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
