import { describe, expect, it } from "vitest";
import { riskConfig } from "./config";
import { classifyRegime, dailyBarsFromOhlc, isRugged, trendFromDaily } from "./regime";

describe("trendFromDaily", () => {
  it("is up only when both highs and lows rise for minPairs steps", () => {
    const up = [
      { high: 1, low: 0.5 },
      { high: 2, low: 1 },
      { high: 3, low: 2 },
    ];
    expect(trendFromDaily(up, 2)).toBe("up");
    expect(trendFromDaily(up.slice(0, 2), 2)).toBe("flat");
  });

  it("is down when both highs and lows fall", () => {
    const down = [
      { high: 3, low: 2 },
      { high: 2, low: 1 },
      { high: 1, low: 0.5 },
    ];
    expect(trendFromDaily(down, 2)).toBe("down");
  });

  it("is flat on mixed higher-high / lower-low", () => {
    expect(
      trendFromDaily(
        [
          { high: 1, low: 0.8 },
          { high: 2, low: 0.4 },
          { high: 3, low: 0.2 },
        ],
        2,
      ),
    ).toBe("flat");
  });
});

describe("dailyBarsFromOhlc", () => {
  it("folds same-UTC-day rows into one high/low", () => {
    const bars = dailyBarsFromOhlc([
      { timeMs: Date.parse("2026-10-01T04:00:00.000Z"), open: 1, high: 2, low: 0.9, close: 1.5 },
      { timeMs: Date.parse("2026-10-01T20:00:00.000Z"), open: 1.5, high: 3, low: 0.8, close: 2 },
      { timeMs: Date.parse("2026-10-02T04:00:00.000Z"), open: 2, high: 2.2, low: 1.9, close: 2.1 },
    ]);
    expect(bars).toEqual([
      { high: 3, low: 0.8 },
      { high: 2.2, low: 1.9 },
    ]);
  });
});

describe("classifyRegime", () => {
  const up = { btc: "up" as const, eth: "up" as const, sol: "flat" as const };
  const down = { btc: "down" as const, eth: "down" as const, sol: "flat" as const };

  it("is HOT when enough majors are up and volume or peak mcap is hot", () => {
    expect(classifyRegime({ ...up, volumeRatio: riskConfig.regime.volume_hot_ratio, avgPeakMcap: 10 }).regime).toBe("HOT");
    expect(classifyRegime({ ...up, volumeRatio: 1, avgPeakMcap: riskConfig.regime.peak_mcap_hot_usd }).regime).toBe("HOT");
    expect(classifyRegime({ ...up, volumeRatio: 1, avgPeakMcap: 10 }).regime).toBe("NEUTRAL");
  });

  it("is COLD when enough majors are down, or volume and peak are both cold", () => {
    expect(classifyRegime({ ...down, volumeRatio: 1, avgPeakMcap: 1_000_000 }).regime).toBe("COLD");
    expect(
      classifyRegime({
        btc: "flat",
        eth: "flat",
        sol: "flat",
        volumeRatio: riskConfig.regime.volume_cold_ratio,
        avgPeakMcap: riskConfig.regime.peak_mcap_cold_usd,
      }).regime,
    ).toBe("COLD");
  });

  it("stays NEUTRAL when majors are missing and volume has no baseline", () => {
    expect(classifyRegime({ btc: "flat", eth: "flat", sol: "flat", volumeRatio: null, avgPeakMcap: null }).regime).toBe("NEUTRAL");
  });
});

describe("isRugged", () => {
  it("flags a drop at the configured percent and not just under", () => {
    expect(isRugged(100, 20, 80)).toBe(true);
    expect(isRugged(100, 20.1, 80)).toBe(false);
    expect(isRugged(null, 1, 80)).toBe(false);
    expect(isRugged(0, 0, 80)).toBe(false);
  });
});
