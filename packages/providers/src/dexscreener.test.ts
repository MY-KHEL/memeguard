import { describe, expect, it } from "vitest";
import { createDexScreener, launchpadFromPair, pickBestPair, type DexPair } from "./dexscreener";
import { jsonResponse, testDeps } from "./test-utils";

const pair = (over: Partial<DexPair> = {}): DexPair => ({
  chainId: "solana",
  dexId: "raydium",
  pairAddress: "PAIR",
  baseToken: { address: "MINT", name: "Test", symbol: "TST" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", name: "SOL", symbol: "SOL" },
  priceUsd: "0.001",
  volume: { m5: 10, h1: 100, h24: 1000 },
  priceChange: { h1: 5 },
  liquidity: { usd: 5000, base: 1, quote: 1 },
  marketCap: 100000,
  pairCreatedAt: 1_700_000_000_000,
  ...over,
});

describe("dexscreener", () => {
  it("returns Solana token refs from profiles", async () => {
    const { deps, calls } = testDeps([jsonResponse([{ chainId: "solana", tokenAddress: "A" }, { chainId: "ethereum", tokenAddress: "B" }])]);
    const dex = createDexScreener(deps);
    const res = await dex.getLatestProfiles();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((t) => t.tokenAddress)).toEqual(["A", "B"]);
    expect(calls[0]?.url).toBe("https://api.dexscreener.com/token-profiles/latest/v1");
  });

  it("chunks token lookups into batches of 30 and merges pairs", async () => {
    const mints = Array.from({ length: 45 }, (_, i) => `M${i}`);
    const { deps, calls } = testDeps([
      jsonResponse(mints.slice(0, 30).map((m) => pair({ baseToken: { address: m, name: m, symbol: m } }))),
      jsonResponse(mints.slice(30).map((m) => pair({ baseToken: { address: m, name: m, symbol: m } }))),
    ]);
    const dex = createDexScreener(deps);
    const res = await dex.getTokens("solana", mints);
    expect(calls.length).toBe(2);
    expect(calls.some((c) => decodeURIComponent(c.url).includes("/tokens/v1/solana/M0,M1"))).toBe(true);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.length).toBe(45);
  });

  it("returns partial data when one batch fails and failure when all fail", async () => {
    const mints = Array.from({ length: 31 }, (_, i) => `M${i}`);
    const partial = testDeps([jsonResponse([pair()]), jsonResponse({}, 500), jsonResponse({}, 500), jsonResponse({}, 500)]);
    const resPartial = await createDexScreener(partial.deps).getTokens("solana", mints);
    expect(resPartial.ok).toBe(true);
    if (resPartial.ok) expect(resPartial.data.length).toBe(1);

    const allBad = testDeps(Array.from({ length: 6 }, () => jsonResponse({}, 503)));
    const resBad = await createDexScreener(allBad.deps).getTokens("solana", mints);
    expect(resBad.ok).toBe(false);
  });

  it("returns empty for an empty mint list without calling upstream", async () => {
    const { deps, calls } = testDeps([]);
    const res = await createDexScreener(deps).getTokens("solana", []);
    expect(res.ok && res.data).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("charges discovery and market endpoints to separate budgets", async () => {
    const { deps, clock } = testDeps([jsonResponse([]), jsonResponse([pair()])]);
    const dex = createDexScreener(deps);
    await dex.getLatestProfiles();
    await dex.getTokens("solana", ["MINT"]);
    const window = Math.floor(clock.now() / 60_000);
    expect(await deps.store.get(`ratelimit:dexscreener:discovery:${window}`)).toBe("1");
    expect(await deps.store.get(`ratelimit:dexscreener:market:${window}`)).toBe("1");
  });

  it("search unwraps pairs and rejects empty queries", async () => {
    const { deps } = testDeps([jsonResponse({ pairs: [pair()] })]);
    const dex = createDexScreener(deps);
    const empty = await dex.search("   ");
    expect(empty.ok).toBe(false);
    const res = await dex.search("TST");
    expect(res.ok && res.data.length).toBe(1);
  });

  it("keeps the default 15s cache separate from a 1s live TTL", async () => {
    const { deps, calls, clock } = testDeps([
      jsonResponse([pair({ priceUsd: "0.001" })]),
      jsonResponse([pair({ priceUsd: "0.002" })]),
      jsonResponse([pair({ priceUsd: "0.003" })]),
    ]);
    const dex = createDexScreener(deps);
    const first = await dex.getTokens("solana", ["MINT"]);
    const cached = await dex.getTokens("solana", ["MINT"]);
    expect(first.ok && !first.fromCache).toBe(true);
    expect(cached.ok && cached.fromCache).toBe(true);
    expect(calls.length).toBe(1);

    const live = await dex.getTokens("solana", ["MINT"], { ttlSeconds: 1 });
    expect(live.ok && !live.fromCache).toBe(true);
    expect(calls.length).toBe(2);
    const liveHit = await dex.getTokens("solana", ["MINT"], { ttlSeconds: 1 });
    expect(liveHit.ok && liveHit.fromCache).toBe(true);
    expect(calls.length).toBe(2);

    clock.advance(1100);
    const liveFresh = await dex.getTokens("solana", ["MINT"], { ttlSeconds: 1 });
    expect(liveFresh.ok && !liveFresh.fromCache).toBe(true);
    if (liveFresh.ok) expect(liveFresh.data[0]?.priceUsd).toBe("0.003");
    expect(calls.length).toBe(3);
  });

  it("tolerates nullable fields in pair payloads", async () => {
    const { deps } = testDeps([
      jsonResponse([{ ...pair(), liquidity: null, priceChange: null, marketCap: null, fdv: "123", info: null, labels: null }]),
    ]);
    const res = await createDexScreener(deps).getTokens("solana", ["MINT"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data[0]?.fdv).toBe(123);
  });
});

describe("pickBestPair", () => {
  it("prefers highest liquidity and only pairs where the token is the base", () => {
    const pairs = [
      pair({ pairAddress: "low", liquidity: { usd: 100 } }),
      pair({ pairAddress: "high", liquidity: { usd: 9000 } }),
      pair({ pairAddress: "other", liquidity: { usd: 99999 }, baseToken: { address: "OTHER", name: "o", symbol: "o" } }),
    ];
    expect(pickBestPair(pairs, "MINT")?.pairAddress).toBe("high");
    expect(pickBestPair(pairs, "NOPE")).toBeUndefined();
  });

  it("breaks liquidity ties toward pump.fun or raydium", () => {
    const pairs = [pair({ pairAddress: "orca", dexId: "orca", liquidity: { usd: 100 } }), pair({ pairAddress: "pump", dexId: "pumpfun", liquidity: { usd: 100 } })];
    expect(pickBestPair(pairs, "MINT")?.pairAddress).toBe("pump");
  });
});

describe("launchpadFromPair", () => {
  it("maps dex ids to launchpads", () => {
    expect(launchpadFromPair(pair({ dexId: "pumpfun" }))).toBe("pump.fun");
    expect(launchpadFromPair(pair({ dexId: "pumpswap" }))).toBe("pump.fun");
    expect(launchpadFromPair(pair({ dexId: "moonshot" }))).toBe("moonshot");
    expect(launchpadFromPair(pair({ dexId: "raydium" }))).toBeNull();
  });
});
