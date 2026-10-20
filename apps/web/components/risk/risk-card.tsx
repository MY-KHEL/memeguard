"use client";

import { useEffect, useState } from "react";
import type { RiskReportDto } from "@meme-guard/shared-types";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/live";
import { VerdictBadge } from "@/components/verdict-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function resultClass(result: string): string {
  if (result === "pass") return "text-emerald-700 dark:text-emerald-300";
  if (result === "fail") return "text-red-700 dark:text-red-300";
  return "text-zinc-600 dark:text-zinc-400";
}

function formatValue(v: string | number | boolean | null): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export function RiskCard({ mint }: { mint: string }) {
  const { verdicts } = useLive();
  const liveTs = verdicts[mint]?.ts ?? "";
  const [report, setReport] = useState<RiskReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .risk(mint)
      .then((r) => {
        if (!cancelled) {
          setReport(r);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [mint, liveTs]);

  if (error) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Risk report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }
  if (!report) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Risk report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading stored report…</p>
        </CardContent>
      </Card>
    );
  }

  const summary =
    report.verdict === "BLOCKED"
      ? `Blocked by ${report.reasons.filter((r) => r.result === "fail").map((r) => r.rule).join(", ") || "a hard filter"}. Visible so you can see why; never tradable here.`
      : report.verdict === "UNVERIFIED"
        ? report.pending
          ? "Not evaluated yet. The worker has been asked to write a report; this page never calls providers itself."
          : `Unverified because a source was missing or down (${report.unavailableSources.join(", ") || "unknown"}). Fail closed: not tradable.`
        : `Passed every hard filter with score ${report.score ?? "—"}. That is risk-reduced, not safe.`;

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Risk report</CardTitle>
        <VerdictBadge verdict={report.verdict} score={report.score} />
      </CardHeader>
      <CardContent>
      <p className="mb-3 text-sm leading-relaxed">{summary}</p>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Config {report.configVersion}
        {report.band ? ` · ${report.band.replace("_", " ")}` : ""}
        {report.pending ? "" : ` · evaluated ${new Date(report.evaluatedAt).toLocaleString()}`}
      </p>

      <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-xs">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Rule</th>
            <th className="py-1 font-medium">Value</th>
            <th className="py-1 font-medium">Threshold</th>
            <th className="py-1 font-medium">Result</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {report.reasons.map((r) => (
            <tr key={r.rule} className="border-t border-border/80">
              <td className="py-1">
                {r.rule}
                {r.detail ? <span className="block font-sans text-[11px] text-muted-foreground">{r.detail}</span> : null}
              </td>
              <td className="py-1">{formatValue(r.value)}</td>
              <td className="py-1">{formatValue(r.threshold)}</td>
              <td className={`py-1 uppercase ${resultClass(r.result)}`}>{r.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {report.factors.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Score factors</h3>
          <ul className="space-y-1 text-xs">
            {report.factors.map((f) => (
              <li key={f.factor} className="flex justify-between gap-3 font-mono">
                <span>
                  {f.factor}
                  {f.disabled ? " (disabled)" : f.unverified ? " (unverified)" : ""}
                  {f.detail ? <span className="mt-0.5 block font-sans text-muted-foreground">{f.detail}</span> : null}
                </span>
                <span>{f.score === null ? "—" : f.score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.unavailableSources.length > 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">Unavailable sources: {report.unavailableSources.join(", ")}</p>
      ) : null}
      </CardContent>
    </Card>
  );
}
