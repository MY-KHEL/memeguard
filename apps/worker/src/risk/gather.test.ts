import { describe, expect, it } from "vitest";
import { sellAmountRaw } from "./gather";

describe("sellAmountRaw", () => {
  it("converts the config USD test size into token base units", () => {
    expect(sellAmountRaw({ testAmountUsd: 10, priceUsd: 0.01, decimals: 6 })).toBe("1000000000");
  });
  it("falls back to a tiny raw amount when price is unknown", () => {
    expect(sellAmountRaw({ testAmountUsd: 10, priceUsd: null, decimals: 6 })).toBe("10000");
  });
});
