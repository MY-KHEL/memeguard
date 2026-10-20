import { createMemoryStore } from "./rate-limit";
import type { ProviderDeps, ProviderLogger } from "./types";

export const silentLog: ProviderLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch stub that replays queued responses (or throws queued errors) in order. */
export function queuedFetch(queue: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error("no queued response");
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

export function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Deps wired to an in-memory store, a fake clock and a queued fetch. */
export function testDeps(queue: Array<Response | Error>, env: ProviderDeps["env"] = {}) {
  const clock = fakeClock();
  const { impl, calls } = queuedFetch(queue);
  const deps: ProviderDeps = {
    store: createMemoryStore(clock.now),
    log: silentLog,
    env,
    fetchImpl: impl,
    now: clock.now,
  };
  return { deps, calls, clock };
}
