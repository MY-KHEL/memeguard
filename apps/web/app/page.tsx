import Link from "next/link";
import { CONFIG_VERSION } from "@meme-guard/core";
import { WorkerHealth } from "@/components/worker-health";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex max-w-3xl flex-col gap-5 pt-4 sm:pt-8">
        <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">Risk-reduced · Non-custodial</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.1]">
          Meme coin trading with the avoidable losses blocked.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Meme Guard blocks rugs, honeypots and bundled supply, then enforces sizing, stops and cooldowns. Every
          verdict shows the rule, the value and the threshold. You connect your own wallet and sign every
          transaction. Risk-reduced, not risk-free.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/explore" className={cn(buttonVariants({ size: "lg" }))}>
            Explore
          </Link>
          <Link href="/trade" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Trade
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-tight text-muted-foreground">System status</h2>
        <WorkerHealth />
        <p className="text-xs text-muted-foreground">
          Risk config version <span className="font-mono">{CONFIG_VERSION}</span>. Thresholds live in
          packages/core/risk-config.json and are calibrated from outcome data.
        </p>
      </section>
    </div>
  );
}
