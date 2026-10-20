"use client";

import { useEffect, useState } from "react";
import type { HoldersResponse } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { fmtNumber, shortAddress } from "@/lib/format";
import { describeReason } from "./candles-panel";
import { ProviderNotice } from "./provider-notice";

type State = { kind: "loading" } | { kind: "ready"; res: HoldersResponse } | { kind: "error"; message: string };

export function HoldersPanel({ mint }: { mint: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api
      .holders(mint, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setState({ kind: "ready", res });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load holders" });
      });
    return () => controller.abort();
  }, [mint, tick]);

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="mb-3 text-sm font-medium">Top holders</h2>
      {state.kind === "loading" ? (
        <p className="text-sm text-zinc-500">Loading holders…</p>
      ) : state.kind === "error" ? (
        <ProviderNotice title="Holders unavailable" detail={state.message} onRetry={() => setTick((n) => n + 1)} />
      ) : !state.res.ok ? (
        <ProviderNotice
          title="Holders unavailable"
          detail={describeReason(state.res.reason, state.res.source, state.res.error)}
          onRetry={() => setTick((n) => n + 1)}
        />
      ) : state.res.data.length === 0 ? (
        <p className="text-sm text-zinc-500">No holder data returned by {state.res.source}.</p>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-black/5 text-sm dark:divide-white/5">
            {state.res.data.map((h, i) => (
              <li key={h.address} className="flex items-center justify-between gap-3 py-1.5">
                <span className="flex items-center gap-2">
                  <span className="w-5 text-right font-mono text-xs text-zinc-500">{i + 1}</span>
                  <a
                    href={`https://solscan.io/account/${h.address}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-mono text-xs hover:underline"
                    title={h.address}
                  >
                    {shortAddress(h.address, 6)}
                  </a>
                  {h.isTokenAccount ? (
                    <span className="rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-white/10" title="Token account address, not the owner wallet">
                      token acct
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3 font-mono text-xs">
                  <span className="text-zinc-500">{fmtNumber(h.uiAmount)}</span>
                  <span className="w-16 text-right">{h.pctOfSupply === null ? "—" : `${h.pctOfSupply.toFixed(2)}%`}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-right font-mono text-[11px] text-zinc-500">
            {state.res.source}
            {state.res.fromCache ? " · cached" : ""}
            {state.res.data.some((h) => h.pctOfSupply === null) ? " · % needs total supply (Helius)" : ""}
          </p>
        </>
      )}
    </section>
  );
}
