"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { TOKEN_SORTS, VERDICTS, tokenListQuerySchema, type TokenListItem, type TokenListQuery, type TokenSort } from "@meme-guard/shared-types";
import { api, ApiError, tokenQueryString } from "@/lib/api-client";
import { fmtAge, fmtPct, fmtPrice, fmtUsd, shortAddress } from "@/lib/format";
import { ExternalLinks } from "@/components/external-links";
import { VerdictBadge } from "@/components/verdict-badge";
import { useWatchMintsStable, useLiveToken } from "@/lib/live";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const REFRESH_MS = 120_000;

const SORT_LABELS: Record<TokenSort, string> = {
  first_seen: "Newest",
  market_cap: "Market cap",
  volume_24h: "Volume 24h",
  liquidity: "Liquidity",
  age: "Pair age",
};

const LAUNCHPADS = ["pump.fun", "moonshot", "launchlab", "meteora-dbc"] as const;

interface PageState {
  key: string;
  items: TokenListItem[];
  total: number;
  nextCursor: string | null;
  generatedAt: string;
}

/** The URL is the single source of truth for filters so views are shareable and survive refresh. */
function parseQuery(sp: URLSearchParams): TokenListQuery {
  const parsed = tokenListQuerySchema.safeParse(Object.fromEntries(sp.entries()));
  return parsed.success ? parsed.data : tokenListQuerySchema.parse({});
}

export function ExploreTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseQuery(searchParams), [searchParams]);
  const { cursor: _ignoredCursor, ...firstPageQuery } = query;
  void _ignoredCursor;
  const queryKey = tokenQueryString(firstPageQuery);

  const [page, setPage] = useState<PageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  // Loading is derived: we have no page yet, or the page we have belongs to a different query.
  const isLoading = error === null && (page === null || page.key !== queryKey);
  const items = page?.items ?? [];
  const total = page?.total ?? 0;
  const nextCursor = page?.key === queryKey ? page.nextCursor : null;
  const updatedAt = page?.generatedAt ?? null;
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");
  const [, startTransition] = useTransition();

  const setParams = useCallback(
    (patch: Partial<Record<keyof TokenListQuery, string | number | undefined>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || v === null) next.delete(k);
        else next.set(k, String(v));
      }
      next.delete("cursor");
      startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Bumping the tick re-runs the fetch effect (manual retry and the live-refresh interval).
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .tokens(parseQuery(new URLSearchParams(queryKey)), { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        setPage({ key: queryKey, items: res.items, total: res.total, nextCursor: res.nextCursor, generatedAt: res.generatedAt });
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load coins");
      });
    return () => controller.abort();
  }, [queryKey, tick]);

  const visibleMints = (page?.key === queryKey ? page.items : []).map((t) => t.mint);
  useWatchMintsStable(visibleMints);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh, paused]);

  // Debounced search: type freely, URL updates after a short pause.
  useEffect(() => {
    const current = query.q ?? "";
    if (searchDraft === current) return;
    const id = setTimeout(() => setParams({ q: searchDraft.trim() || undefined }), 350);
    return () => clearTimeout(id);
  }, [searchDraft, query.q, setParams]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    // Live refresh would reset the list to page one, so pause it while paging.
    setPaused(true);
    try {
      const res = await api.tokens({ ...firstPageQuery, cursor: nextCursor });
      setPage((prev) => {
        if (!prev || prev.key !== queryKey) return prev;
        const seen = new Set(prev.items.map((i) => i.mint));
        return { ...prev, items: [...prev.items, ...res.items.filter((i) => !seen.has(i.mint))], nextCursor: res.nextCursor };
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, queryKey]);

  const toggleSort = (sort: TokenSort) => {
    if (query.sort === sort) setParams({ dir: query.dir === "desc" ? "asc" : "desc" });
    else setParams({ sort, dir: "desc" });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every fresh Solana coin the scanner sees, including blocked and unverified ones. Badges are risk-reduced signals, not guarantees.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{total.toLocaleString()} tracked</span>
          {updatedAt ? <span className="font-mono">updated {new Date(updatedAt).toLocaleTimeString()}</span> : null}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="min-h-8 rounded-lg border border-border px-2 py-1 hover:bg-muted"
            aria-pressed={paused}
          >
            {paused ? "Resume live" : "Pause live"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search name, ticker or paste a contract address"
          className="min-w-0 w-full flex-1 sm:min-w-64"
          aria-label="Search coins"
        />
        <select
          value={query.launchpad ?? ""}
          onChange={(e) => setParams({ launchpad: e.target.value || undefined })}
          className="min-h-9 rounded-lg border border-border bg-transparent px-2 py-2 text-sm"
          aria-label="Launchpad"
        >
          <option value="">All launchpads</option>
          {LAUNCHPADS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={query.verdict ?? ""}
          onChange={(e) => setParams({ verdict: e.target.value || undefined })}
          className="min-h-9 rounded-lg border border-border bg-transparent px-2 py-2 text-sm"
          aria-label="Verdict"
        >
          <option value="">All verdicts</option>
          {VERDICTS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <NumberFilter key={`liq:${query.minLiquidity ?? ""}`} label="Min liq $" value={query.minLiquidity} onChange={(v) => setParams({ minLiquidity: v })} />
        <NumberFilter key={`vol:${query.minVolume24h ?? ""}`} label="Min vol 24h $" value={query.minVolume24h} onChange={(v) => setParams({ minVolume24h: v })} />
        <NumberFilter key={`age:${query.maxAgeHours ?? ""}`} label="Max age h" value={query.maxAgeHours} onChange={(v) => setParams({ maxAgeHours: v })} />
        {hasFilters(query) ? (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {error !== null ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300/60 bg-red-50 p-3 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200"
        >
          <span className="font-medium">Could not refresh the list.</span> <span className="font-mono text-xs">{error}</span>
          {items.length ? <span className="ml-2 text-xs opacity-80">Showing the last successful result.</span> : null}
          <button type="button" onClick={refresh} className="ml-3 text-xs underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Coin</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
              <SortHeader label="Price" />
              {TOKEN_SORTS.filter((s) => s !== "first_seen").map((s) => (
                <SortHeader key={s} label={SORT_LABELS[s]} active={query.sort === s} dir={query.dir} onClick={() => toggleSort(s)} />
              ))}
              <SortHeader label="1h" />
              <SortHeader label="Seen" active={query.sort === "first_seen"} dir={query.dir} onClick={() => toggleSort("first_seen")} />
              <th className="px-3 py-2 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  Loading coins…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  {query.q
                    ? "No tracked coin matches. New coins appear within about 30 seconds of being listed."
                    : "No coins yet. The worker scanner fills this list within about 30 seconds of starting."}
                </td>
              </tr>
            ) : (
              items.map((t) => <Row key={t.mint} token={t} />)
            )}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function hasFilters(q: TokenListQuery): boolean {
  return Boolean(q.q || q.launchpad || q.verdict || q.minLiquidity !== undefined || q.minVolume24h !== undefined || q.maxAgeHours !== undefined);
}

function NumberFilter({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  // Parent passes a key derived from `value`, so this remounts when the URL changes.
  const [draft, setDraft] = useState(value?.toString() ?? "");
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        min={0}
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onChange(draft === "" ? undefined : Number(draft))}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChange(draft === "" ? undefined : Number(draft));
        }}
        className="h-8 w-24 rounded-lg border border-input bg-transparent px-2 text-sm"
      />
    </label>
  );
}

function SortHeader({ label, active, dir, onClick }: { label: string; active?: boolean; dir?: "asc" | "desc"; onClick?: () => void }) {
  const content = (
    <span className="inline-flex items-center gap-1">
      {label}
      {active ? <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span> : null}
    </span>
  );
  return (
    <th className="px-3 py-2 font-medium">
      {onClick ? (
        <button type="button" onClick={onClick} className={`hover:text-foreground ${active ? "text-foreground" : ""}`}>
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

function Row({ token }: { token: TokenListItem }) {
  const t = useLiveToken(token);
  const change = t.priceChange1hPct;
  const changeClass = change === null ? "text-zinc-500" : change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <tr className="border-t border-border/80 hover:bg-muted/40">
      <td className="px-3 py-2">
        <Link href={`/explore/${t.mint}`} className="flex items-center gap-2">
          {t.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per token; not worth whitelisting
            <img src={t.imageUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full bg-black/5 object-cover" loading="lazy" />
          ) : (
            <span className="inline-block h-6 w-6 rounded-full bg-black/10 dark:bg-white/10" aria-hidden />
          )}
          <span className="flex flex-col leading-tight">
            <span className="font-medium">
              {t.symbol ?? shortAddress(t.mint)}
              {t.launchpad ? <span className="ml-2 rounded-md bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{t.launchpad}</span> : null}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">{t.name ? `${t.name} · ` : ""}{shortAddress(t.mint, 5)}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2">
        <VerdictBadge verdict={t.verdict} score={t.riskScore} />
      </td>
      <td className="px-3 py-2 font-mono text-xs">{fmtPrice(t.priceUsd)}</td>
      <td className="px-3 py-2 font-mono text-xs">{fmtUsd(t.marketCapUsd)}</td>
      <td className="px-3 py-2 font-mono text-xs">{fmtUsd(t.volume24hUsd)}</td>
      <td className="px-3 py-2 font-mono text-xs">{fmtUsd(t.liquidityUsd)}</td>
      <td className="px-3 py-2 font-mono text-xs">{fmtAge(t.createdAt)}</td>
      <td className={`px-3 py-2 font-mono text-xs ${changeClass}`}>{fmtPct(change)}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground" title={t.firstSeenAt}>
        {fmtAge(t.firstSeenAt)} ago
      </td>
      <td className="px-3 py-2">
        <ExternalLinks mint={t.mint} pairAddress={t.pairAddress} compact />
      </td>
    </tr>
  );
}
