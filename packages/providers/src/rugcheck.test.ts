import { describe, expect, it } from "vitest";
import { createRugCheck, isBondingCurveMarket, normaliseRugCheckReport } from "./rugcheck";
import { jsonResponse, testDeps } from "./test-utils";

const fixture = {
  mint: "MINT",
  creator: "CREATOR",
  freezeAuthority: null,
  mintAuthority: "AUTH",
  token: { mintAuthority: "AUTH", freezeAuthority: null, decimals: 6, supply: 1_000_000 },
  topHolders: [
    { address: "LP_TA", owner: "LP_OWNER", pct: 40, uiAmount: 400, insider: false },
    { address: "H1", owner: "W1", pct: 4.2, uiAmount: 42, insider: false },
    { address: "H2", owner: "W2", pct: 1.1, uiAmount: 11, insider: false },
  ],
  markets: [
    {
      pubkey: "POOL",
      marketType: "pump_fun_amm",
      liquidityA: "LP_TA",
      liquidityB: "LP_SOL",
      lp: { lpLockedPct: 99.9, quoteUSD: 1000, baseUSD: 1000 },
    },
  ],
  totalMarketLiquidity: 2000,
  totalHolders: 120,
  rugged: false,
  knownAccounts: { LP_OWNER: { name: "Pump Fun AMM", type: "AMM" } },
  insiderNetworks: [{ id: "net-1", size: 10, tokenAmount: 250_000, currentHolding: 250_000, activeAccounts: 10 }],
  launchpad: { name: "Pump.Fun", platform: "pump_fun" },
  creatorTokens: [1, 2, 3],
  risks: [{ name: "High holder correlation", value: "(12)", description: "similar supply", level: "warn" }],
};

describe("rugcheck", () => {
  it("marks LP accounts and computes the largest non-LP holder", () => {
    const n = normaliseRugCheckReport(fixture);
    expect(n.mintAuthority).toBe("AUTH");
    expect(n.freezeAuthority).toBeNull();
    expect(n.topHolders[0]?.isLp).toBe(true);
    expect(n.topHolders[1]?.isLp).toBe(false);
    expect(n.largestNonLpHolderPct).toBe(4.2);
    expect(n.lpLockedPct).toBe(99.9);
    expect(n.onBondingCurve).toBe(false);
    expect(n.bundledClusterSupplyPct).toBe(25);
    expect(n.creatorTokenCount).toBe(3);
  });

  it("treats pump_fun (not pump_fun_amm) as a bonding curve", () => {
    expect(isBondingCurveMarket("pump_fun", "pump_fun")).toBe(true);
    expect(isBondingCurveMarket("pump_fun_amm", "pump_fun")).toBe(false);
    const curve = normaliseRugCheckReport({ ...fixture, markets: [{ pubkey: "C", marketType: "pump_fun", lp: { lpLockedPct: 0 } }] });
    expect(curve.onBondingCurve).toBe(true);
  });

  it("fetches and caches the report", async () => {
    const { deps, calls } = testDeps([jsonResponse(fixture)]);
    const rc = createRugCheck(deps);
    const first = await rc.getReport("MINT");
    const second = await rc.getReport("MINT");
    expect(first.ok && first.data.largestNonLpHolderPct).toBe(4.2);
    expect(second.ok && second.fromCache).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe("https://api.rugcheck.xyz/v1/tokens/MINT/report");
  });

  it("returns not_found for unknown mints", async () => {
    const { deps } = testDeps([jsonResponse({ error: "no" }, 404)]);
    const res = await createRugCheck(deps).getReport("NOPE");
    expect(!res.ok && res.reason).toBe("not_found");
  });
});
