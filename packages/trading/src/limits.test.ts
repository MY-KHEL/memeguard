import { describe, expect, it } from "vitest";
import { tradingConfig } from "./config";
import { checkLimits } from "./limits";
import type { LimitRequest, LimitState } from "./types";

const thesis = "I am buying because liquidity held through the first dump.";
const sellReason = "I will sell if the thesis breaks or the stop hits.";

function state(over: Partial<LimitState> = {}): LimitState {
  return {
    paperBalanceSol: 50,
    equitySol: 50,
    dayStartEquitySol: 50,
    openPositions: [],
    lastLosingTradeAt: null,
    now: new Date("2026-10-05T12:00:00.000Z"),
    ...over,
  };
}

function req(over: Partial<LimitRequest> = {}): LimitRequest {
  return {
    mint: "MINT",
    sizeSol: 2.5, // 5% of 50
    marketCapUsd: 1_000_000,
    scoreBand: "MEDIUM",
    thesis,
    sellReason,
    priceChange1hPct: 0,
    fomoConfirmed: false,
    ...over,
  };
}

function failed(check: ReturnType<typeof checkLimits>, rule: string) {
  return check.violations.filter((v) => v.rule === rule && v.result === "fail");
}

describe("checkLimits", () => {
  it("passes at the per-coin bound and fails one increment over", () => {
    const at = checkLimits(state(), req({ sizeSol: 2.5 }));
    expect(at.ok).toBe(true);
    expect(at.applied.maxPct).toBe(tradingConfig.limits.max_pct_per_coin.default);

    const over = checkLimits(state(), req({ sizeSol: 2.5000001 }));
    expect(over.ok).toBe(false);
    expect(failed(over, "max_pct_per_coin")).toHaveLength(1);
  });

  it("counts an add-on against the same mint toward the cap", () => {
    const s = state({ openPositions: [{ mint: "MINT", remainingCostSol: 2 }] });
    const over = checkLimits(s, req({ sizeSol: 1 }));
    expect(over.ok).toBe(false);
    expect(failed(over, "max_pct_per_coin")).toHaveLength(1);
  });

  it("passes at max open positions and rejects a new mint over the cap", () => {
    const open = Array.from({ length: 5 }, (_, i) => ({ mint: `M${i}`, remainingCostSol: 1 }));
    const at = checkLimits(state({ openPositions: open }), req({ mint: "M0", sizeSol: 1 }));
    expect(failed(at, "max_open_positions")).toHaveLength(0);

    const over = checkLimits(state({ openPositions: open }), req({ mint: "NEW", sizeSol: 1 }));
    expect(over.ok).toBe(false);
    expect(failed(over, "max_open_positions")).toHaveLength(1);
  });

  it("applies the low-mcap cap at the bound and fails over it", () => {
    const at = checkLimits(state(), req({ marketCapUsd: 499_999, sizeSol: 1 })); // 2% of 50
    expect(failed(at, "max_pct_low_mcap")).toHaveLength(0);
    expect(at.ok).toBe(true);

    const over = checkLimits(state(), req({ marketCapUsd: 499_999, sizeSol: 1.0000001 }));
    expect(over.ok).toBe(false);
    expect(failed(over, "max_pct_low_mcap")).toHaveLength(1);
  });

  it("uses the HIGH-risk cap from config, not a hardcoded score", () => {
    const at = checkLimits(state(), req({ scoreBand: "HIGH", sizeSol: 1 }));
    expect(at.ok).toBe(true);
    expect(at.applied.maxPct).toBe(tradingConfig.limits.high_risk_max_pct.default);

    const over = checkLimits(state(), req({ scoreBand: "HIGH", sizeSol: 1.0000001 }));
    expect(over.ok).toBe(false);
    expect(failed(over, "high_risk_max_pct")).toHaveLength(1);
  });

  it("locks buys when daily loss is at or over the bound and not when just under", () => {
    const under = checkLimits(state({ equitySol: 45.0001, dayStartEquitySol: 50 }), req());
    expect(failed(under, "daily_loss_lock")).toHaveLength(0);

    const at = checkLimits(state({ equitySol: 45, dayStartEquitySol: 50 }), req());
    expect(at.ok).toBe(false);
    expect(failed(at, "daily_loss_lock")).toHaveLength(1);
    expect(at.applied.dailyLossLocked).toBe(true);
  });

  it("blocks buys during the cooldown after a losing trade and allows at the boundary", () => {
    const lostAt = new Date("2026-10-05T11:00:00.000Z");
    const still = checkLimits(state({ lastLosingTradeAt: lostAt, now: new Date("2026-10-05T11:59:59.000Z") }), req());
    expect(still.ok).toBe(false);
    expect(failed(still, "cooldown_after_loss")).toHaveLength(1);

    const done = checkLimits(state({ lastLosingTradeAt: lostAt, now: new Date("2026-10-05T12:00:00.000Z") }), req());
    expect(failed(done, "cooldown_after_loss")).toHaveLength(0);
  });

  it("rejects a missing thesis or sell reason", () => {
    expect(checkLimits(state(), req({ thesis: "short" })).ok).toBe(false);
    expect(failed(checkLimits(state(), req({ thesis: "short" })), "thesis_required")).toHaveLength(1);
    expect(checkLimits(state(), req({ sellReason: "" })).ok).toBe(false);
  });

  it("requires FOMO confirm when the 1h change is at or above the config threshold", () => {
    const pct = tradingConfig.discipline.fomo_1h_change_pct;
    const denied = checkLimits(state(), req({ priceChange1hPct: pct, fomoConfirmed: false }));
    expect(denied.ok).toBe(false);
    expect(failed(denied, "fomo_confirm_required")).toHaveLength(1);

    const ok = checkLimits(state(), req({ priceChange1hPct: pct, fomoConfirmed: true }));
    expect(failed(ok, "fomo_confirm_required")).toHaveLength(0);
  });

  it("clamps user overrides to config bounds", () => {
    const huge = checkLimits(state(), req({ sizeSol: 10 }), { maxPctPerCoin: 80 });
    expect(huge.applied.maxPct).toBe(tradingConfig.limits.max_pct_per_coin.max);
  });

  it("halves size caps in COLD from trading-config, still allowing a reduced buy", () => {
    const coldAt = checkLimits(state({ regime: "COLD" }), req({ sizeSol: 1.25 }));
    expect(coldAt.ok).toBe(true);
    expect(coldAt.applied.maxPct).toBe(tradingConfig.limits.max_pct_per_coin.default * tradingConfig.regime.cold_size_multiplier);

    const coldOver = checkLimits(state({ regime: "COLD" }), req({ sizeSol: 2.5 }));
    expect(coldOver.ok).toBe(false);
    expect(failed(coldOver, "max_pct_per_coin")).toHaveLength(1);
  });

  it("fails when size exceeds paper cash", () => {
    const over = checkLimits(state({ paperBalanceSol: 1 }), req({ sizeSol: 2 }));
    expect(failed(over, "insufficient_balance")).toHaveLength(1);
  });
});
