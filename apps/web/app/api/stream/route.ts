import { candleTimeframeSchema, liveEventSchema, looksLikeMint } from "@meme-guard/shared-types";
import Redis from "ioredis";
import { getWebEnv } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { LIVE_CHANNEL, registerChart, registerWatched } from "@/lib/trading/publish";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mints = url.searchParams.get("mints")?.split(",").filter(looksLikeMint) ?? [];
  const chartMint = url.searchParams.get("chart");
  const tf = candleTimeframeSchema.safeParse(url.searchParams.get("tf"));
  const chart = chartMint && looksLikeMint(chartMint) && tf.success ? { mint: chartMint, tf: tf.data } : null;
  const allowed = new Set(mints);
  if (chart) allowed.add(chart.mint);

  const refreshWatch = () => {
    void registerWatched(mints).catch(() => undefined);
    if (chart) void registerChart(chart.mint, chart.tf).catch(() => undefined);
  };
  refreshWatch();
  const session = await getSession();
  const env = getWebEnv();

  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      send({ type: "heartbeat", ts: new Date().toISOString() });

      const onMessage = (_channel: string, message: string) => {
        const parsed = liveEventSchema.safeParse(JSON.parse(message) as unknown);
        if (!parsed.success) return;
        const ev = parsed.data;
        if (ev.type === "position.update" && session && ev.userId !== session.userId) return;
        if (ev.type === "notification.new" && session && ev.userId !== session.userId) return;
        if (ev.type === "notification.new" && !session) return;
        const market = ev.type === "token.tick" || ev.type === "token.candle" || ev.type === "token.stats";
        if (market && allowed.size > 0 && !allowed.has(ev.mint)) return;
        send(ev);
      };
      subscriber.subscribe(LIVE_CHANNEL).catch(() => undefined);
      subscriber.on("message", onMessage);

      const beat = setInterval(() => {
        send({ type: "heartbeat", ts: new Date().toISOString() });
        refreshWatch();
      }, 15_000);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        subscriber.off("message", onMessage);
        void subscriber.quit();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      closed = true;
      void subscriber.quit();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
