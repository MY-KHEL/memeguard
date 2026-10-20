/** Phase 5 only. The backend never sees a private key. */
export function assertLiveDisabled(): never {
  throw new Error("live trading is not enabled");
}
