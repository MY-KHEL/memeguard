"use client";

import { useEffect, useState } from "react";
import { JOB_GRACE_SECONDS, isJobStale, type AppHealth, type DependencyCheck, type JobStats } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";

const POLL_MS = 10_000;

type State = { kind: "loading" } | { kind: "ready"; health: AppHealth } | { kind: "error"; message: string };

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`}
    />
  );
}

function JobRow({
  label,
  job,
  uptimeSeconds,
  extra,
}: {
  label: string;
  job?: JobStats;
  uptimeSeconds: number;
  extra?: string;
}) {
  if (!job) {
    return (
      <li className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-xs">waiting</span>
      </li>
    );
  }
  const stale = isJobStale(job, uptimeSeconds);
  const detail = job.lastError
    ? job.lastError
    : job.lastRunAt
      ? `${job.lastCycleMs ?? 0} ms · ${new Date(job.lastRunAt).toLocaleTimeString("en-US", { hour12: false })}${extra ? ` · ${extra}` : ""}`
      : uptimeSeconds >= JOB_GRACE_SECONDS
        ? "stuck"
        : "starting";
  return (
    <li className="flex min-w-0 items-center justify-between gap-4 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <Dot ok={!stale} />
        {label}
      </span>
      <span className="max-w-[60%] truncate font-mono text-xs">{detail}</span>
    </li>
  );
}

function CheckRow({ label, check }: { label: string; check: DependencyCheck }) {
  return (
    <li className="flex items-center justify-between gap-4 text-sm">
      <span className="flex items-center gap-2">
        <Dot ok={check.status === "ok"} />
        {label}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {check.status === "ok" ? `${check.latencyMs ?? 0} ms` : (check.error ?? "down")}
      </span>
    </li>
  );
}

export function WorkerHealth() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const health = await api.health();
        if (!cancelled) setState({ kind: "ready", health });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Could not reach /api/health";
        if (!cancelled) setState({ kind: "error", message });
      }
    }
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (state.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Checking worker health...</p>;
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-red-300/60 bg-red-50 p-4 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-medium">Health check failed</p>
        <p className="mt-1 font-mono text-xs">{state.message}</p>
      </div>
    );
  }

  const { health } = state;
  const headline =
    health.status === "ok" ? "Worker healthy" : health.status === "degraded" ? "Worker degraded" : "Worker unavailable";

  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="flex items-center gap-2 font-medium">
          <Dot ok={health.status === "ok"} />
          {headline}
        </p>
        <span className="font-mono text-xs text-muted-foreground" suppressHydrationWarning>
          checked {new Date(health.checkedAt).toLocaleTimeString("en-US", { hour12: false })}
        </span>
      </div>

      {health.worker.reachable ? (
        <ul className="mt-3 flex flex-col gap-2">
          <CheckRow label="Postgres" check={health.worker.report.checks.postgres} />
          <CheckRow label="Redis" check={health.worker.report.checks.redis} />
          <li className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>Worker uptime</span>
            <span className="font-mono text-xs">{health.worker.report.uptimeSeconds}s · v{health.worker.report.version}</span>
          </li>
          <JobRow
            label="Scanner"
            job={health.worker.report.scanner}
            uptimeSeconds={health.worker.report.uptimeSeconds}
            extra={health.worker.report.scanner ? `${health.worker.report.scanner.tokensTracked} tracked` : undefined}
          />
          <JobRow
            label="Risk"
            job={health.worker.report.risk}
            uptimeSeconds={health.worker.report.uptimeSeconds}
            extra={health.worker.report.risk ? `${health.worker.report.risk.reportsTotal} reports` : undefined}
          />
          <JobRow label="Regime" job={health.worker.report.regime} uptimeSeconds={health.worker.report.uptimeSeconds} />
          <JobRow label="Outcomes" job={health.worker.report.outcomes} uptimeSeconds={health.worker.report.uptimeSeconds} />
          <JobRow label="Alerts" job={health.worker.report.alerts} uptimeSeconds={health.worker.report.uptimeSeconds} />
        </ul>
      ) : (
        <p className="mt-3 font-mono text-xs text-muted-foreground">{health.worker.error}</p>
      )}
    </div>
  );
}
