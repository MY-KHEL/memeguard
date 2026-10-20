import { describe, expect, it } from "vitest";
import { makeSessionToken, readSessionToken } from "./session";

describe("session cookie", () => {
  it("round-trips a signed payload and rejects a tampered one", () => {
    const token = makeSessionToken("11111111-1111-1111-1111-111111111111", "Wallet111", "secret");
    expect(readSessionToken(token, "secret")?.wallet).toBe("Wallet111");
    expect(readSessionToken(token, "wrong")).toBeNull();
    expect(readSessionToken(token.slice(0, -2) + "xx", "secret")).toBeNull();
  });
});
