import { describe, expect, it } from "vitest";
import { ageDays, analyseHolders, assignClusters, summariseWallets } from "./wallets";

describe("wallet analysis", () => {
  it("computes age in whole days", () => {
    const now = Date.UTC(2026, 9, 10);
    expect(ageDays(now / 1000 - 3 * 86_400, now)).toBe(3);
    expect(ageDays(null, now)).toBeNull();
  });

  it("clusters wallets that share a funding source and keeps insider ids", () => {
    const map = assignClusters(
      [
        { wallet: "A", fundingSource: "F1" },
        { wallet: "B", fundingSource: "F1" },
        { wallet: "C", fundingSource: "F2" },
        { wallet: "D", fundingSource: null },
      ],
      [{ id: "net", wallets: ["D"] }],
    );
    expect(map.get("A")).toBe("fund:F1");
    expect(map.get("B")).toBe("fund:F1");
    expect(map.has("C")).toBe(false);
    expect(map.get("D")).toBe("insider:net");
  });

  it("counts fresh wallets and the largest same-source group", () => {
    const summary = summariseWallets(
      [
        { wallet: "A", walletAgeDays: 1, isFresh: true, fundingSource: "F", clusterId: "fund:F", isBundlerFlag: true },
        { wallet: "B", walletAgeDays: 1, isFresh: true, fundingSource: "F", clusterId: "fund:F", isBundlerFlag: true },
        { wallet: "C", walletAgeDays: 40, isFresh: false, fundingSource: "G", clusterId: null, isBundlerFlag: false },
      ],
      new Map([
        ["A", 10],
        ["B", 12],
        ["C", 3],
      ]),
    );
    expect(summary.freshCount).toBe(2);
    expect(summary.maxSameSource).toBe(2);
    expect(summary.bundledPct).toBe(22);
  });

  it("reuses cached rows and marks unverified when a lookup fails", async () => {
    const now = new Date("2026-10-03T00:00:00Z");
    const cached = new Map([
      ["OLD", { walletAgeDays: 40, fundingSource: "F", checkedAt: now }],
    ]);
    const calls: string[] = [];
    const res = await analyseHolders({
      helius: {
        isConfigured: () => true,
        getAsset: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
        getTokenLargestAccounts: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
        getFirstTransaction: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
        getSwaps: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
      },
      holders: [
        { tokenAccount: "t1", owner: "OLD", pct: 2, uiAmount: 1, isLp: false },
        { tokenAccount: "t2", owner: "NEW", pct: 2, uiAmount: 1, isLp: false },
      ],
      cached,
      insiderGroups: [],
      freshMaxAgeDays: 7,
      now,
      lookup: async (address) => {
        calls.push(address);
        return "unavailable";
      },
    });
    expect(calls).toEqual(["NEW"]);
    expect(res.rows.find((r) => r.wallet === "OLD")?.walletAgeDays).toBe(40);
    expect(res.unverified).toBe(true);
  });

  it("is unverified when every holder is an LP or the list is empty", async () => {
    const res = await analyseHolders({
      helius: {
        isConfigured: () => true,
        getAsset: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
        getTokenLargestAccounts: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
        getFirstTransaction: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
        getSwaps: async () => ({ ok: false, reason: "unavailable", source: "helius" }),
      },
      holders: [{ tokenAccount: "lp", owner: "POOL", pct: 90, uiAmount: 1, isLp: true }],
      cached: new Map(),
      insiderGroups: [],
      freshMaxAgeDays: 7,
    });
    expect(res.unverified).toBe(true);
    expect(res.rows).toHaveLength(0);
  });
});
