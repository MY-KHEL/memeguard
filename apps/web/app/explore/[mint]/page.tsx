import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { looksLikeMint, type TokenDetail } from "@meme-guard/shared-types";
import { ExternalLinks } from "@/components/external-links";
import { CandlesPanel } from "@/components/token/candles-panel";
import { HoldersPanel } from "@/components/token/holders-panel";
import { RiskCard } from "@/components/risk/risk-card";
import { ProviderNotice } from "@/components/token/provider-notice";
import { LiveMarket, LivePrice } from "@/components/token/live-stats";
import { LiveVerdictBadge, LiveTradeGate } from "@/components/token/live-verdict";
import { fmtAge, fmtNumber, fmtPrice, fmtUsd, shortAddress } from "@/lib/format";
import { loadTokenDetail } from "@/lib/token-detail";

export const dynamic = "force-dynamic";

// Server component: row + Helius metadata render on the server (same code path
// as /api/tokens/[mint]); candles and holders stream in client-side.

export async function generateMetadata({ params }: PageProps<"/explore/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  return { title: `${shortAddress(mint)} · Explore · Meme Guard` };
}

export default async function TokenDetailPage({ params }: PageProps<"/explore/[mint]">) {
  const { mint } = await params;
  if (!looksLikeMint(mint)) notFound();
  const token = await loadTokenDetail(mint);
  if (!token) notFound();

  return (
    <article className="flex flex-col gap-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/explore" className="hover:underline">
          Explore
        </Link>{" "}
        / <span className="font-mono">{shortAddress(mint, 6)}</span>
      </nav>

      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          {token.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per token
            <img src={token.imageUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full bg-black/5 object-cover" />
          ) : (
            <span className="inline-block h-12 w-12 rounded-full bg-black/10 dark:bg-white/10" aria-hidden />
          )}
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {token.symbol ?? shortAddress(mint)}
              <LiveVerdictBadge mint={mint} verdict={token.verdict} score={token.riskScore} />
              {token.launchpad ? <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{token.launchpad}</span> : null}
            </h1>
            <p className="text-sm text-muted-foreground">{token.name ?? "Name unknown"}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="break-all select-all">{mint}</span>
              <ExternalLinks mint={mint} pairAddress={token.pairAddress} compact />
            </p>
          </div>
        </div>
        <LivePrice
          mint={mint}
          priceUsd={token.priceUsd}
          marketCapUsd={token.marketCapUsd}
          liquidityUsd={token.liquidityUsd}
          volume24hUsd={token.volume24hUsd}
          priceChange1hPct={token.priceChange1hPct}
        />
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <LiveMarket
          mint={mint}
          priceUsd={token.priceUsd}
          marketCapUsd={token.marketCapUsd}
          liquidityUsd={token.liquidityUsd}
          volume24hUsd={token.volume24hUsd}
          priceChange1hPct={token.priceChange1hPct}
        />
        <Stat label="Pair age" value={fmtAge(token.createdAt)} suppressHydrationWarning />
        <Stat label="Supply" value={fmtNumber(token.supplyUi)} hint={token.sources.metadata === "helius" ? "Helius" : "needs Helius"} />
        <Stat label="Decimals" value={token.decimals === null ? "—" : String(token.decimals)} />
        <Stat
          label="Mint authority"
          value={token.sources.metadata !== "helius" ? "—" : token.mintAuthority ? shortAddress(token.mintAuthority) : "revoked"}
          hint={token.mintAuthority ? "supply can still be inflated" : undefined}
          tone={token.sources.metadata !== "helius" ? undefined : token.mintAuthority ? "bad" : "good"}
        />
        <Stat
          label="Freeze authority"
          value={token.sources.metadata !== "helius" ? "—" : token.freezeAuthority ? shortAddress(token.freezeAuthority) : "revoked"}
          hint={token.freezeAuthority ? "accounts can be frozen" : undefined}
          tone={token.sources.metadata !== "helius" ? undefined : token.freezeAuthority ? "bad" : "good"}
        />
      </section>

      {token.sources.metadata !== "helius" ? (
        <ProviderNotice
          title="On-chain metadata unavailable"
          detail="Helius is not configured or did not answer, so supply and authority fields are unknown. Unknown is treated as unverified, not as safe."
        />
      ) : null}

      <LiveTradeGate mint={mint} symbol={token.symbol} verdict={token.verdict} priceChange1hPct={token.priceChange1hPct} />

      <RiskCard mint={mint} />

      <CandlesPanel mint={mint} />

      <div className="grid gap-6 lg:grid-cols-2">
        <HoldersPanel mint={mint} />
        <SnapshotsPanel snapshots={token.snapshots} />
      </div>

      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
        First seen {fmtAge(token.firstSeenAt)} ago · last refreshed {token.lastSnapshotAt ? `${fmtAge(token.lastSnapshotAt)} ago` : "never"} · {token.dexId ?? "dex unknown"}
      </p>
    </article>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  suppressHydrationWarning,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
  suppressHydrationWarning?: boolean;
}) {
  const toneClass = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "";
  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-sm ${toneClass}`} suppressHydrationWarning={suppressHydrationWarning}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SnapshotsPanel({ snapshots }: { snapshots: TokenDetail["snapshots"] }) {
  const recent = [...snapshots].reverse().slice(0, 12);
  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="mb-3 text-sm font-medium">Recent scanner snapshots</h2>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No snapshots yet. The scanner refreshes tracked coins every cycle.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Time</th>
              <th className="py-1 font-medium">Price</th>
              <th className="py-1 font-medium">Mcap</th>
              <th className="py-1 font-medium">Liq</th>
              <th className="py-1 font-medium">Vol 5m</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {recent.map((s) => (
              <tr key={s.ts} className="border-t border-border/80">
                <td className="py-1 text-muted-foreground">{s.ts.slice(11, 19)}</td>
                <td className="py-1">{fmtPrice(s.priceUsd)}</td>
                <td className="py-1">{fmtUsd(s.marketCapUsd)}</td>
                <td className="py-1">{fmtUsd(s.liquidityUsd)}</td>
                <td className="py-1">{fmtUsd(s.volume5mUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
