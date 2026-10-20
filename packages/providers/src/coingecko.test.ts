import { describe, expect, it } from "vitest";
import { createCoinGecko } from "./coingecko";
import { jsonResponse, testDeps } from "./test-utils";

describe("coingecko", () => {
  it("maps OHLC tuples and caches", async () => {
    const row = [1_700_000_000_000, 1, 2, 0.5, 1.5];
    const { deps, calls } = testDeps([jsonResponse([row])]);
    const cg = createCoinGecko(deps);
    const first = await cg.getOhlc("bitcoin", 14);
    const second = await cg.getOhlc("bitcoin", 14);
    expect(first.ok && first.data[0]).toEqual({ timeMs: row[0], open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(second.ok && second.fromCache).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain("/coins/bitcoin/ohlc");
  });

  it("returns not_found for an empty series", async () => {
    const { deps } = testDeps([jsonResponse([])]);
    const res = await createCoinGecko(deps).getOhlc("solana");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });
});
