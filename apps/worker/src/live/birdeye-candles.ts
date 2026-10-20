import {
  candleTimeframeSchema,
  looksLikeMint,
  type CandleTimeframe,
  type TokenCandle,
  type TokenStats,
} from "@meme-guard/shared-types";
import type { Logger } from "../logger";
import type { ChartWatch, LiveBus } from "./bus";

const CHART_LIMIT = 100;
const POLL_MS = 2_000;
const PING_MS = 30_000;
const BIRDEYE_SOCKET = "wss://public-api.birdeye.so/socket/solana";

const TO_BIRDEYE: Record<CandleTimeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

const FROM_BIRDEYE: Record<string, CandleTimeframe> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "1h": "1h",
  "4H": "4h",
  "4h": "4h",
  "1D": "1d",
  "1d": "1d",
};

export function birdeyeChartType(timeframe: CandleTimeframe): string {
  return TO_BIRDEYE[timeframe];
}

export function priceSubscription(charts: ChartWatch[]): Record<string, unknown> | null {
  const usable = charts.filter((chart) => looksLikeMint(chart.mint) && candleTimeframeSchema.safeParse(chart.timeframe).success);
  if (usable.length === 0) return null;
  if (usable.length === 1) {
    const chart = usable[0]!;
    return {
      type: "SUBSCRIBE_PRICE",
      data: {
        queryType: "simple",
        chartType: birdeyeChartType(chart.timeframe),
        address: chart.mint,
        currency: "usd",
        mode: "raw",
        chartBy: "price",
      },
    };
  }
  const query = usable
    .slice(0, CHART_LIMIT)
    .map((chart) => `(address = ${chart.mint} AND chartType = ${birdeyeChartType(chart.timeframe)} AND currency = usd)`)
    .join(" OR ");
  return { type: "SUBSCRIBE_PRICE", data: { queryType: "complex", query } };
}

export function statsSubscription(mints: string[]): Record<string, unknown> | null {
  const unique = [...new Set(mints.filter(looksLikeMint))].slice(0, CHART_LIMIT);
  if (unique.length === 0) return null;
  return {
    type: "SUBSCRIBE_TOKEN_STATS",
    data: {
      address: unique.length === 1 ? unique[0] : unique,
      select: {
        price: true,
        supply: true,
        marketcap: true,
        liquidity: true,
        trade_data: {
          volume: true,
          price_change: true,
          intervals: ["1h", "24h"],
        },
      },
    },
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parsePriceMessage(message: unknown, ts: string): TokenCandle | null {
  if (!message || typeof message !== "object") return null;
  const root = message as { type?: unknown; data?: unknown };
  if (root.type !== "PRICE_DATA" || !root.data || typeof root.data !== "object") return null;
  const data = root.data as Record<string, unknown>;
  const mint = typeof data.address === "string" ? data.address : "";
  const timeframe = FROM_BIRDEYE[typeof data.type === "string" ? data.type : ""];
  const open = num(data.o);
  const high = num(data.h);
  const low = num(data.l);
  const close = num(data.c);
  const volume = num(data.v) ?? 0;
  const time = num(data.unixTime);
  if (!looksLikeMint(mint) || !timeframe || open === null || high === null || low === null || close === null || time === null) return null;
  if (open <= 0 || high < low || high < close || low > close || close <= 0 || volume < 0) return null;
  return {
    type: "token.candle",
    mint,
    timeframe,
    time: Math.floor(time),
    open,
    high,
    low,
    close,
    volume,
    ts,
  };
}

export function parseStatsMessage(message: unknown, ts: string): TokenStats | null {
  if (!message || typeof message !== "object") return null;
  const root = message as { type?: unknown; data?: unknown };
  if (root.type !== "TOKEN_STATS_DATA" || !root.data || typeof root.data !== "object") return null;
  const data = root.data as Record<string, unknown>;
  const mint = typeof data.address === "string" ? data.address : "";
  if (!looksLikeMint(mint)) return null;
  const circulatingSupply = num(data.circulating_supply);
  const liquidityUsd = num(data.liquidity);
  const volume24hUsd = num(data.volume_24h_usd);
  const priceChange1hPct = num(data.price_change_1h_percent);
  if (circulatingSupply === null && liquidityUsd === null && volume24hUsd === null && priceChange1hPct === null) return null;
  return {
    type: "token.stats",
    mint,
    circulatingSupply: circulatingSupply !== null && circulatingSupply > 0 ? circulatingSupply : null,
    liquidityUsd,
    volume24hUsd,
    priceChange1hPct,
    ts,
  };
}

async function textOf(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (data && typeof data === "object" && "text" in data && typeof (data as { text: unknown }).text === "function") {
    const text = await (data as { text: () => Promise<string> }).text();
    return typeof text === "string" ? text : null;
  }
  return null;
}

export function createBirdeyeCandles(deps: { bus: LiveBus; log: Logger; apiKey: string | undefined }) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let generation = 0;
  let poll: NodeJS.Timeout | null = null;
  let ping: NodeJS.Timeout | null = null;
  let reconnect: NodeJS.Timeout | null = null;
  let delay = 1_000;
  let subscribed = "";
  let ignored = 0;
  let giveUp = false;

  function send(ws: WebSocket, payload: Record<string, unknown>) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  async function push(ws: WebSocket) {
    let charts: ChartWatch[] = [];
    try {
      charts = await deps.bus.watchedCharts(CHART_LIMIT);
    } catch (error) {
      deps.log.warn({ err: String(error) }, "birdeye chart watch failed");
      return;
    }
    const signature = charts.map((chart) => `${chart.mint}|${chart.timeframe}`).join(",");
    if (signature === subscribed) return;
    subscribed = signature;
    if (charts.length === 0) {
      send(ws, { type: "UNSUBSCRIBE_PRICE" });
      send(ws, { type: "UNSUBSCRIBE_TOKEN_STATS" });
      deps.log.info("birdeye candle socket idle");
      return;
    }
    const price = priceSubscription(charts);
    const stats = statsSubscription(charts.map((chart) => chart.mint));
    if (price) send(ws, price);
    if (stats) send(ws, stats);
    deps.log.info({ charts: charts.length }, "birdeye candle subscribe");
  }

  async function onMessage(raw: unknown) {
    const text = await textOf(raw);
    if (!text) {
      if (ignored < 5) {
        ignored += 1;
        deps.log.warn({ kind: raw === null ? "null" : typeof raw }, "birdeye candle message had no text");
      }
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      if (ignored < 5) {
        ignored += 1;
        deps.log.warn({ sample: text.slice(0, 240) }, "birdeye candle message was not json");
      }
      return;
    }
    const type = parsed && typeof parsed === "object" && "type" in parsed ? String((parsed as { type?: unknown }).type) : "";
    if (type === "PING" && socket) {
      send(socket, { type: "PONG" });
      return;
    }
    if (type === "WELCOME") return;
    if (type === "ERROR") {
      const message = parsed && typeof parsed === "object" && "data" in parsed ? String((parsed as { data?: unknown }).data) : "rejected";
      if (subscribed && !giveUp) {
        giveUp = true;
        deps.log.warn({ message }, "birdeye candle socket rejected; chart stays on the quote");
        socket?.close();
      }
      return;
    }
    const ts = new Date().toISOString();
    const candle = parsePriceMessage(parsed, ts);
    if (candle) {
      await deps.bus.publish(candle);
      return;
    }
    const stats = parseStatsMessage(parsed, ts);
    if (stats) {
      await deps.bus.publish(stats);
      return;
    }
    if (ignored < 5) {
      ignored += 1;
      deps.log.warn({ type: type || "no-type", sample: text.slice(0, 240) }, "birdeye candle message ignored");
    }
  }

  function connect() {
    if (stopped || !deps.apiKey) return;
    const gen = ++generation;
    subscribed = "";
    let ws: WebSocket;
    try {
      const Socket = WebSocket as unknown as new (
        url: string,
        options: { protocols: string[]; headers: Record<string, string> },
      ) => WebSocket;
      ws = new Socket(`${BIRDEYE_SOCKET}?x-api-key=${encodeURIComponent(deps.apiKey)}`, {
        protocols: ["echo-protocol"],
        headers: { Origin: "ws://public-api.birdeye.so" },
      });
    } catch (error) {
      deps.log.warn({ err: String(error) }, "birdeye candle socket failed to open");
      schedule();
      return;
    }
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      if (gen !== generation || stopped) {
        ws.close();
        return;
      }
      delay = 1_000;
      deps.log.info("birdeye candle socket open");
      void push(ws);
    });
    ws.addEventListener("message", (event) => {
      if (gen !== generation) return;
      void onMessage(event.data).catch((error: unknown) => deps.log.warn({ err: String(error) }, "birdeye candle message failed"));
    });
    ws.addEventListener("error", () => {
      deps.log.warn("birdeye candle socket error");
    });
    ws.addEventListener("close", () => {
      if (gen !== generation || stopped) return;
      deps.log.warn({ delay }, "birdeye candle socket closed");
      schedule();
    });
  }

  function schedule() {
    if (stopped || giveUp) return;
    if (reconnect) clearTimeout(reconnect);
    reconnect = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30_000);
  }

  return {
    start() {
      if (!deps.apiKey) {
        deps.log.info("birdeye candle socket skipped");
        return;
      }
      stopped = false;
      deps.log.info("birdeye candle socket starting");
      connect();
      poll = setInterval(() => {
        if (giveUp) return;
        if (socket && socket.readyState === WebSocket.OPEN) void push(socket);
      }, POLL_MS);
      ping = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) send(socket, { type: "PING" });
      }, PING_MS);
    },
    stop() {
      stopped = true;
      generation += 1;
      if (poll) clearInterval(poll);
      if (ping) clearInterval(ping);
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      socket = null;
    },
  };
}
