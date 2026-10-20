import type { Verdict } from "@meme-guard/shared-types";
import { Badge } from "@/components/ui/badge";

const STYLES: Record<Verdict, { variant: "default" | "destructive" | "outline"; label: string; title: string }> = {
  PASS: {
    variant: "default",
    label: "PASS",
    title: "Passed every hard filter and has a risk score. Risk-reduced, not risk-free.",
  },
  BLOCKED: {
    variant: "destructive",
    label: "BLOCKED",
    title: "Failed at least one hard filter. Visible, never tradable.",
  },
  UNVERIFIED: {
    variant: "outline",
    label: "UNVERIFIED",
    title: "No risk report yet or a data source was unavailable. Not tradable until verified.",
  },
};

export function VerdictBadge({ verdict, score }: { verdict: Verdict; score?: number | null }) {
  const s = STYLES[verdict];
  return (
    <Badge variant={s.variant} title={s.title} className="font-mono tracking-wide">
      {s.label}
      {verdict === "PASS" && typeof score === "number" ? <span className="opacity-70">{score}</span> : null}
    </Badge>
  );
}
