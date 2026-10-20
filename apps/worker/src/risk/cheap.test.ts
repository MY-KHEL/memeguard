import { describe, expect, it } from "vitest";
import { riskConfig } from "@meme-guard/core";
import { cheapGate, type CheapMarket } from "./cheap";

const sol = 150;
const floors = riskConfig.hard_filters;

function market(patch: Partial<CheapMarket> = {}): CheapMarket {
  return {
    volume24hUsd: 80_000,
    volume5mUsd: floors.recent_activity.min_volume_5m_usd,
    volume1hUsd: floors.recent_activity.min_volume_1h_usd,
    marketCapUsd: 80_000,
    liquidityUsd: floors.min_liquidity_sol.value * sol,
    ageHours: 12,
    solUsd: sol,
    ...patch,
  };
}

describe("cheapGate", () => {
  it("passes when volume, recent prints, and liquidity clear the config floors", () => {
    expect(cheapGate(market()).verdict).toBe("PASS");
  });

  it("blocks just below the age-scaled volume floor", () => {
    const mature = floors.volume_vs_mcap.mature_min_ratio;
    const young = floors.volume_vs_mcap.young_min_ratio;
    expect(cheapGate(market({ volume24hUsd: mature * 10_000 - 1, marketCapUsd: 10_000, ageHours: 12 })).verdict).toBe("BLOCKED");
    expect(cheapGate(market({ volume24hUsd: young * 10_000, marketCapUsd: 10_000, ageHours: 1 })).verdict).toBe("PASS");
    expect(cheapGate(market({ volume24hUsd: young * 10_000 - 1, marketCapUsd: 10_000, ageHours: 1 })).verdict).toBe("BLOCKED");
  });

  it("blocks when both recent windows are known and quiet", () => {
    const five = floors.recent_activity.min_volume_5m_usd;
    const hour = floors.recent_activity.min_volume_1h_usd;
    expect(cheapGate(market({ volume5mUsd: five - 1, volume1hUsd: hour - 1 })).verdict).toBe("BLOCKED");
    expect(cheapGate(market({ volume5mUsd: five, volume1hUsd: 0 })).verdict).toBe("PASS");
  });

  it("blocks just below the minimum liquidity", () => {
    const minUsd = floors.min_liquidity_sol.value * sol;
    expect(cheapGate(market({ liquidityUsd: minUsd })).verdict).toBe("PASS");
    expect(cheapGate(market({ liquidityUsd: minUsd - 1 })).verdict).toBe("BLOCKED");
  });

  it("is unverified when volume or liquidity is missing and nothing failed", () => {
    expect(cheapGate(market({ volume24hUsd: null })).verdict).toBe("UNVERIFIED");
    expect(cheapGate(market({ liquidityUsd: null })).verdict).toBe("UNVERIFIED");
    expect(cheapGate(market({ volume5mUsd: null, volume1hUsd: null })).verdict).toBe("UNVERIFIED");
    expect(cheapGate(market({ solUsd: null })).verdict).toBe("UNVERIFIED");
  });
});
