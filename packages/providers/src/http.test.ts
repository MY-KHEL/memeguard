import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fetchJson } from "./http";
import { jsonResponse, queuedFetch } from "./test-utils";

const schema = z.object({ value: z.number() });

describe("fetchJson", () => {
  it("returns parsed data on 200", async () => {
    const { impl } = queuedFetch([jsonResponse({ value: 1 })]);
    const res = await fetchJson({ source: "dexscreener", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.value).toBe(1);
  });

  it("retries on 500 then succeeds", async () => {
    const { impl, calls } = queuedFetch([jsonResponse({}, 500), jsonResponse({ value: 2 })]);
    const res = await fetchJson({ source: "dexscreener", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl });
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it("gives up after retries and reports unavailable", async () => {
    const { impl, calls } = queuedFetch([jsonResponse({}, 503), jsonResponse({}, 503), jsonResponse({}, 503)]);
    const res = await fetchJson({ source: "helius", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl, retries: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unavailable");
    expect(calls.length).toBe(3);
  });

  it("reports rate_limited on persistent 429", async () => {
    const { impl } = queuedFetch([jsonResponse({}, 429), jsonResponse({}, 429)]);
    const res = await fetchJson({ source: "birdeye", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl, retries: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("rate_limited");
  });

  it("does not retry 4xx other than 429", async () => {
    const { impl, calls } = queuedFetch([jsonResponse({}, 400)]);
    const res = await fetchJson({ source: "birdeye", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl });
    expect(res.ok).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("maps configured statuses to not_found", async () => {
    const { impl } = queuedFetch([jsonResponse({}, 404)]);
    const res = await fetchJson({
      source: "geckoterminal",
      url: "https://x/y",
      schema,
      timeoutMs: 1000,
      fetchImpl: impl,
      notFoundStatuses: [404],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });

  it("reports timeout when fetch aborts", async () => {
    const err = new Error("aborted");
    err.name = "TimeoutError";
    const { impl } = queuedFetch([err, err, err]);
    const res = await fetchJson({ source: "helius", url: "https://x/y", schema, timeoutMs: 10, fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("timeout");
  });

  it("reports invalid_response when the body fails the schema", async () => {
    const { impl } = queuedFetch([jsonResponse({ value: "nope" })]);
    const res = await fetchJson({ source: "dexscreener", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("invalid_response");
      expect(res.error).toContain("value");
    }
  });

  it("reports invalid_response on non-JSON body", async () => {
    const { impl } = queuedFetch([new Response("<html>", { status: 200 })]);
    const res = await fetchJson({ source: "dexscreener", url: "https://x/y", schema, timeoutMs: 1000, fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_response");
  });
});
