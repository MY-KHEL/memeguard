import { describe, expect, it } from "vitest";
import { createHelius } from "./helius";
import { jsonResponse, testDeps } from "./test-utils";

const assetBody = {
  jsonrpc: "2.0",
  id: "meme-guard",
  result: {
    id: "MINT",
    content: { metadata: { name: "Test Coin", symbol: "TST" }, links: { image: "https://img" } },
    authorities: [{ address: "AUTH", scopes: ["full"] }],
    mutable: true,
    burnt: false,
    token_info: { supply: 1000000000000000, decimals: 6, token_program: "Tokenkeg", mint_authority: null, freeze_authority: "FRZ" },
  },
};

describe("helius", () => {
  it("reports not_configured without a key", async () => {
    const { deps, calls } = testDeps([]);
    const h = createHelius(deps);
    expect(h.isConfigured()).toBe(false);
    const res = await h.getAsset("MINT");
    expect(!res.ok && res.reason).toBe("not_configured");
    expect(calls.length).toBe(0);
  });

  it("posts JSON-RPC with the api key and maps asset fields", async () => {
    const { deps, calls } = testDeps([jsonResponse(assetBody)], { HELIUS_API_KEY: "KEY" });
    const res = await createHelius(deps).getAsset("MINT");
    expect(calls[0]?.url).toBe("https://mainnet.helius-rpc.com/?api-key=KEY");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ method: "getAsset", params: { id: "MINT" } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({
        mint: "MINT",
        symbol: "TST",
        decimals: 6,
        supplyRaw: "1000000000000000",
        supplyUi: 1_000_000_000,
        mintAuthority: null,
        freezeAuthority: "FRZ",
      });
    }
  });

  it("turns RPC error objects into failures", async () => {
    const { deps } = testDeps([jsonResponse({ jsonrpc: "2.0", id: "1", error: { code: -32029, message: "Rate limit exceeded" } })], {
      HELIUS_API_KEY: "KEY",
    });
    const res = await createHelius(deps).getAsset("MINT");
    expect(!res.ok && res.reason).toBe("rate_limited");
  });

  it("maps largest accounts", async () => {
    const body = {
      jsonrpc: "2.0",
      id: "1",
      result: { context: { slot: 1 }, value: [{ address: "TA1", amount: "500", decimals: 2, uiAmount: 5, uiAmountString: "5" }] },
    };
    const { deps } = testDeps([jsonResponse(body)], { HELIUS_API_KEY: "KEY" });
    const res = await createHelius(deps).getTokenLargestAccounts("MINT");
    expect(res.ok && res.data[0]).toEqual({ tokenAccount: "TA1", amountRaw: "500", uiAmount: 5, decimals: 2 });
  });

  it("maps the first enhanced transaction to age and funding source", async () => {
    const body = [{ signature: "SIG", timestamp: 1_700_000_000, nativeTransfers: [{ fromUserAccount: "FUNDER", toUserAccount: "WALLET", amount: 1 }] }];
    const { deps, calls } = testDeps([jsonResponse(body)], { HELIUS_API_KEY: "KEY" });
    const res = await createHelius(deps).getFirstTransaction("WALLET");
    expect(calls[0]?.url).toContain("https://api.helius.xyz/v0/addresses/WALLET/transactions");
    expect(calls[0]?.url).toContain("sort-order=asc");
    expect(res.ok && res.data).toEqual({ signature: "SIG", timestamp: 1_700_000_000, fundingSource: "FUNDER" });
  });

  it("classifies SWAP token transfers as buy or sell", async () => {
    const body = [
      { signature: "B", timestamp: 1, tokenTransfers: [{ mint: "MINT", toUserAccount: "WALLET" }] },
      { signature: "S", timestamp: 2, tokenTransfers: [{ mint: "MINT", fromUserAccount: "WALLET" }] },
    ];
    const { deps } = testDeps([jsonResponse(body)], { HELIUS_API_KEY: "KEY" });
    const res = await createHelius(deps).getSwaps("WALLET", "MINT");
    expect(res.ok && res.data.map((s) => s.side)).toEqual(["buy", "sell"]);
  });
});
