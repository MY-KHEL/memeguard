"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { CalibrationReport } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";

export function CalibrationClient() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .calibration()
      .then(setReport)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load calibration"));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!report) return <p className="text-sm text-muted-foreground">Loading outcomes…</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {report.outcomeCount} twenty-four-hour outcomes
        {report.oldestBaseTs ? ` from ${new Date(report.oldestBaseTs).toLocaleDateString()} to ${new Date(report.newestBaseTs ?? report.oldestBaseTs).toLocaleDateString()}` : ""}.
        {report.enoughHistory ? " A week of history is available." : " Need at least a week of outcome rows before treating rates as evidence."}
      </p>

      <Table
        title="Blocked rules vs rugs (24h drop)"
        empty={report.byRule.length === 0 ? "No BLOCKED outcomes yet. Helius 429s keep many coins UNVERIFIED." : null}
      >
        {report.byRule.map((r) => (
          <tr key={r.rule}>
            <td className="px-3 py-1.5 font-mono text-xs">{r.rule}</td>
            <td className="px-3 py-1.5 text-right">{r.blocked}</td>
            <td className="px-3 py-1.5 text-right">{r.rugged}</td>
            <td className="px-3 py-1.5 text-right">{r.ruggedRate === null ? "—" : `${Math.round(r.ruggedRate * 100)}%`}</td>
          </tr>
        ))}
      </Table>

      <Table title="PASS coins by score band (avg 24h return)" empty={report.byBand.length === 0 ? "No PASS 24h outcomes yet." : null}>
        {report.byBand.map((r) => (
          <tr key={r.band}>
            <td className="px-3 py-1.5 font-mono text-xs">{r.band}</td>
            <td className="px-3 py-1.5 text-right">{r.pass}</td>
            <td className="px-3 py-1.5 text-right">{r.avgReturnPct === null ? "—" : `${r.avgReturnPct.toFixed(1)}%`}</td>
          </tr>
        ))}
      </Table>

      <Table title="Config versions">
        {report.byConfigVersion.map((r) => (
          <tr key={r.configVersion}>
            <td className="px-3 py-1.5 font-mono text-xs">{r.configVersion}</td>
            <td className="px-3 py-1.5 text-right">{r.reports}</td>
            <td className="px-3 py-1.5 text-right">{r.rugged}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Table({ title, children, empty }: { title: string; children: ReactNode; empty?: string | null }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        {empty ? (
          <p className="p-3 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>{children}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
