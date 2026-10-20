import { describe, expect, it } from "vitest";
import { createBirdeye, toBirdeyeType } from "./birdeye";
import { jsonResponse, testDeps } from "./test-utils";

describe("birdeye", () => {
  it("reports not_configured without a key and never calls upstream", async () => {
    const { deps, calls } = testDeps([jsonResponse({})]);
    const be = createBirdeye(deps);
    expect(be.isConfigured()).toBe(false);
    const res = await be.getTokenOverview("MINT");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_configured");
    expect(calls.length).toBe(0);
  });

  it("sends the API key and chain headers", async () => {
    const { deps, calls } = testDeps([jsonResponse({ success: true, data: { price: 1, marketCap: 10 } })], { BIRDEYE_API_KEY: "k" });
    const res = await createBirdeye(deps).getTokenOverview("MINT");
    expect(res.ok && res.data.marketCapUsd).toBe(10);
    expect(calls[0]?.init?.headers).toMatchObject({ "X-API-KEY": "k", "x-chain": "solana" });
    expect(calls[0]?.url).toBe("https://public-api.birdeye.so/defi/token_overview?address=MINT");
  });

  it("maps OHLCV items to candles", async () => {
    const body = { success: true, data: { items: [{ unixTime: 200, o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }, { unixTime: 100, o: 1, h: 1, l: 1, c: 1, v: null }] } };
    const { deps, calls } = testDeps([jsonResponse(body)], { BIRDEYE_API_KEY: "k" });
    const res = await createBirdeye(deps).getOhlcv("MINT", "1h", 0, 300);
    expect(calls[0]?.url).toContain("type=1H");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((c) => [c.time, c.volume])).toEqual([[100, 0], [200, 9]]);
  });

  it("maps holders", async () => {
    const body = { success: true, data: { items: [{ owner: "W1", ui_amount: 12.5, amount: "12500", token_account: "TA" }] } };
    const { deps } = testDeps([jsonResponse(body)], { BIRDEYE_API_KEY: "k" });
    const res = await createBirdeye(deps).getHolders("MINT", 5);
    expect(res.ok && res.data[0]).toEqual({ owner: "W1", uiAmount: 12.5, tokenAccount: "TA" });
  });

  it("maps timeframes", () => {
    expect(toBirdeyeType("15m")).toBe("15m");
    expect(toBirdeyeType("1d")).toBe("1D");
  });
});
