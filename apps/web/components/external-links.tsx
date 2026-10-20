"use client";

/** Outbound links for a token. Always open in a new tab with no referrer leakage. */
export function ExternalLinks({ mint, pairAddress, compact = false }: { mint: string; pairAddress: string | null; compact?: boolean }) {
  const linkClass =
    "rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted";
  const dexUrl = pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : `https://dexscreener.com/solana/${mint}`;
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a className={linkClass} href={dexUrl} target="_blank" rel="noopener noreferrer nofollow" title="Open on DexScreener">
        {compact ? "DEX" : "DexScreener"}
      </a>
      <a className={linkClass} href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener noreferrer nofollow" title="Open on Solscan">
        {compact ? "SOL" : "Solscan"}
      </a>
    </span>
  );
}
