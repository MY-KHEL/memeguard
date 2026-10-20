import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createProviderClient } from "./client";
import { createMemoryStore, createRateLimiter } from "./rate-limit";
import { fakeClock, jsonResponse, queuedFetch, silentLog } from "./test-utils";

const schema = z.object({ n: z.number() });

function makeClient(queue: Array<Response | Error>, limit = 60) {
  const clock = fakeClock();
  const store = createMemoryStore(clock.now);
  const { impl, calls } = queuedFetch(queue);
  const client = createProviderClient(
    { name: "dexscreener", baseUrl: "https://api.example.com", rateLimitPerMinute: limit, timeoutMs: 1000 },
    { store, log: silentLog, env: {}, fetchImpl: impl, now: clock.now },
  );
  return { client, calls, clock, store };
}

describe("createProviderClient", () => {
  it("builds the URL from base, path and query", async () => {
    const { client, calls } = makeClient([jsonResponse({ n: 1 })]);
    await client.request({ path: "/tokens/v1/solana/abc", schema, query: { limit: 5, skip: undefined } });
    expect(calls[0]?.url).toBe("https://api.example.com/tokens/v1/solana/abc?limit=5");
  });

  it("serves the second call from cache", async () => {
    const { client, calls } = makeClient([jsonResponse({ n: 1 })]);
    const first = await client.request({ path: "/a", schema, cache: { parts: ["a"], ttlSeconds: 30 } });
    const second = await client.request({ path: "/a", schema, cache: { parts: ["a"], ttlSeconds: 30 } });
    expect(first.ok && !first.fromCache).toBe(true);
    expect(second.ok && second.fromCache).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("expires cache entries after the TTL", async () => {
    const { client, calls, clock } = makeClient([jsonResponse({ n: 1 }), jsonResponse({ n: 2 })]);
    await client.request({ path: "/a", schema, cache: { parts: ["a"], ttlSeconds: 1 } });
    clock.advance(1500);
    const res = await client.request({ path: "/a", schema, cache: { parts: ["a"], ttlSeconds: 1 } });
    expect(res.ok && res.data.n).toBe(2);
    expect(calls.length).toBe(2);
  });

  it("does not cache failures", async () => {
    const { client, calls } = makeClient([jsonResponse({}, 500), jsonResponse({}, 500), jsonResponse({}, 500), jsonResponse({ n: 3 })]);
    const bad = await client.request({ path: "/a", schema, cache: { parts: ["a"], ttlSeconds: 30 } });
    const good = await client.request({ path: "/a", schema, cache: { parts: ["a"], ttlSeconds: 30 } });
    expect(bad.ok).toBe(false);
    expect(good.ok && good.data.n).toBe(3);
    expect(calls.length).toBe(4);
  });

  it("returns rate_limited once the per-minute budget is spent", async () => {
    const responses = Array.from({ length: 3 }, (_, i) => jsonResponse({ n: i }));
    const { client, calls } = makeClient(responses, 2);
    const a = await client.request({ path: "/a", schema });
    const b = await client.request({ path: "/b", schema });
    const c = await client.request({ path: "/c", schema });
    expect(a.ok && b.ok).toBe(true);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("rate_limited");
    expect(calls.length).toBe(2);
  });

  it("resets the budget in the next minute window", async () => {
    const { client, clock } = makeClient([jsonResponse({ n: 1 }), jsonResponse({ n: 2 })], 1);
    expect((await client.request({ path: "/a", schema })).ok).toBe(true);
    expect((await client.request({ path: "/b", schema })).ok).toBe(false);
    clock.advance(60_000);
    expect((await client.request({ path: "/c", schema })).ok).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("rejects the 61st call in a 60 per minute bucket", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(createMemoryStore(clock.now), silentLog, clock.now);
    const results: boolean[] = [];
    for (let i = 0; i < 61; i++) results.push(await limiter.take("dex", 60));
    expect(results.filter(Boolean).length).toBe(60);
    expect(results[60]).toBe(false);
  });

  it("allows the request when the store throws", async () => {
    const broken = {
      get: async () => null,
      set: async () => "OK",
      incr: async () => {
        throw new Error("redis down");
      },
      pexpire: async () => 1,
    };
    const limiter = createRateLimiter(broken, silentLog);
    expect(await limiter.take("x", 1)).toBe(true);
  });
});
