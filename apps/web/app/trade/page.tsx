import { TradeList } from "@/components/trade/trade-list";
import { TradeRefresh } from "@/components/trade/trade-refresh";
import { loadTradeCandidates } from "@/lib/trade-candidates";

export const dynamic = "force-dynamic";
export const metadata = { title: " Trade · Meme Guard " };

export default async function TradePage() {
  const { items } = await loadTradeCandidates();

  return (
    <section className="flex flex-col gap-4">
      <TradeRefresh />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trade</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only coins whose latest report is PASS, newer than the report age cap, ranked by score. Rows show 1h and 24h volume.
          Paper fills use the live Jupiter quote, including impact. Passing filters is risk-reduced, not safe.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
          No coins currently pass with a fresh report. Quiet volume, missing data, and reports older than the age cap stay off this list. BLOCKED and UNVERIFIED never appear here.
        </p>
      ) : (
        <TradeList items={items} />
      )}
    </section>
  );
}
