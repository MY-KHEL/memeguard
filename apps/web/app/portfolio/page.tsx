import { PortfolioClient } from "@/components/portfolio/portfolio-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio · Meme Guard" };

export default function PortfolioPage() {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open paper positions, mark-to-market PnL, exposure and limit status. Stops on thin liquidity can slip or fail.
        </p>
      </header>
      <PortfolioClient />
    </section>
  );
}
