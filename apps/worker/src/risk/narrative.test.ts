import { describe, expect, it } from "vitest";
import { normalizeNarrativeLabel } from "./narrative";

describe("normalizeNarrativeLabel", () => {
  it("folds case and extra spaces", () => {
    expect(normalizeNarrativeLabel("  Pepe   Coin ")).toBe("pepe coin");
  });
  it("drops a label too short to mean anything", () => {
    expect(normalizeNarrativeLabel("A")).toBeNull();
    expect(normalizeNarrativeLabel("  ")).toBeNull();
    expect(normalizeNarrativeLabel(null)).toBeNull();
  });
  it("keeps a two-character ticker", () => {
    expect(normalizeNarrativeLabel("AI")).toBe("ai");
  });
});
