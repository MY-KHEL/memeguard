import { describe, expect, it } from "vitest";
import { JOB_GRACE_SECONDS, isJobStale } from "@meme-guard/shared-types";

describe("isJobStale", () => {
  it("ignores missing stats and a first tick still inside the grace window", () => {
    expect(isJobStale(undefined, 3_600)).toBe(false);
    expect(isJobStale({ lastRunAt: null, lastError: null }, JOB_GRACE_SECONDS - 1)).toBe(false);
  });

  it("treats a finished cycle as healthy even after a long uptime", () => {
    expect(isJobStale({ lastRunAt: "2026-10-17T06:00:00.000Z", lastError: null }, 10_000)).toBe(false);
  });

  it("flags a lastError or a null lastRunAt after the grace window", () => {
    expect(isJobStale({ lastRunAt: "2026-10-17T06:00:00.000Z", lastError: "boom" }, 10)).toBe(true);
    expect(isJobStale({ lastRunAt: null, lastError: null }, JOB_GRACE_SECONDS)).toBe(true);
  });
});
