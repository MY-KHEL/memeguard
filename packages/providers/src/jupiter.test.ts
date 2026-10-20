import { describe, expect, it } from "vitest";
import { createJupiter } from "./jupiter";
import { jsonResponse, testDeps } from "./test-utils";

describe("jupiter", () => {
  it("quotes a sell without a taker and maps price impact", async () => {
    const body = {
      outAmount: "12345",
      priceImpact: 2.5,
      routePlan: [{ swapInfo: { label: "Raydium" } }],
    };
    const { deps, calls } = testDeps([jsonResponse(body)], { JUPITER_API_KEY: "k" });
    const res = await createJupiter(deps).simulateSell({ mint: "MINT", amountRaw: "1000000" });
    expect(res.ok && res.data).toMatchObject({ quoted: true, priceImpactPct: 2.5, outAmountLamports: "12345", routeLabels: ["Raydium"] });
    expect(calls[0]?.url).toContain("/swap/v2/order");
    expect(calls[0]?.url).toContain("inputMint=MINT");
    expect(calls[0]?.url).not.toContain("taker=");
    expect(calls[0]?.init?.headers).toMatchObject({ "x-api-key": "k" });
  });

  it("treats a missing outAmount as an unquoted sell, not an outage", async () => {
    const { deps } = testDeps([jsonResponse({ errorCode: "NO_ROUTES_FOUND", errorMessage: "no route" })]);
    const res = await createJupiter(deps).simulateSell({ mint: "MINT", amountRaw: "1" });
    expect(res.ok && res.data).toMatchObject({ quoted: false, reason: "error", code: "NO_ROUTES_FOUND" });
  });

  it("quotes a buy from SOL to mint without a taker", async () => {
    const body = { outAmount: "900", priceImpact: 1.1, inAmount: "1000000000" };
    const { deps, calls } = testDeps([jsonResponse(body)], { JUPITER_API_KEY: "k" });
    const res = await createJupiter(deps).quoteSwap({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "MINT",
      amountRaw: "1000000000",
    });
    expect(res.ok && res.data).toMatchObject({ quoted: true, outAmountLamports: "900", priceImpactPct: 1.1 });
    expect(calls[0]?.url).toContain("inputMint=So11111111111111111111111111111111111111112");
    expect(calls[0]?.url).toContain("outputMint=MINT");
    expect(calls[0]?.url).not.toContain("taker=");
  });

  it("passes through upstream failures as ProviderResult", async () => {
    const { deps } = testDeps([jsonResponse({ error: "no" }, 500)]);
    const res = await createJupiter(deps).simulateSell({ mint: "MINT", amountRaw: "1" });
    expect(!res.ok && res.reason).toBe("unavailable");
  });
});
