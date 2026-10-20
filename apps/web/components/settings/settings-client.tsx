"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ALERT_PREFS, type AlertPrefs } from "@meme-guard/shared-types";
import { tradingConfig } from "@meme-guard/trading";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/components/wallet/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SettingsClient() {
  const { me, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const limits = me?.limitSettings ?? {
    maxPctPerCoin: tradingConfig.limits.max_pct_per_coin.default,
    maxOpenPositions: tradingConfig.limits.max_open_positions.default,
    maxPctLowMcap: tradingConfig.limits.max_pct_low_mcap.default,
    dailyLossPct: tradingConfig.limits.daily_loss_pct.default,
    cooldownAfterLossMinutes: tradingConfig.limits.cooldown_after_loss_minutes.default,
    highRiskMaxPct: tradingConfig.limits.high_risk_max_pct.default,
    lowMcapUsd: tradingConfig.limits.low_mcap_usd,
  };
  const [draft, setDraft] = useState(limits);
  const [alerts, setAlerts] = useState<AlertPrefs>(me?.alerts ?? DEFAULT_ALERT_PREFS);

  useEffect(() => {
    if (me) {
      setDraft(me.limitSettings);
      setAlerts(me.alerts);
    }
  }, [me]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.patchSettings({ limits: draft, alerts });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      {me ? (
        <p className="font-mono text-xs text-muted-foreground">
          Signed in as {me.wallet}. Paper balance {me.paperBalanceSol.toFixed(3)} SOL.
          {me.regime ? ` Regime ${me.regime}.` : ""}
          {me.regime === "COLD"
            ? ` Effective size caps are ${Math.round(tradingConfig.regime.cold_size_multiplier * 100)}% of the values below.`
            : ""}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Connect Phantom or Solflare and sign a message to create a session. Meme Guard never asks for a seed phrase.</p>
      )}
      {!me ? (
        <button
          type="button"
          className="w-fit rounded-lg border border-border px-3 py-1.5 text-xs"
          onClick={() =>
            void api
              .authDev()
              .then(() => refresh())
              .catch((err) => setError(err instanceof ApiError ? err.message : "Dev sign-in is off. Set DEV_WALLET in .env."))
          }
        >
          Dev sign-in
        </button>
      ) : null}

      <Field label={`Max % per coin (${tradingConfig.limits.max_pct_per_coin.min}–${tradingConfig.limits.max_pct_per_coin.max})`} value={draft.maxPctPerCoin} onChange={(n) => setDraft({ ...draft, maxPctPerCoin: n })} />
      <Field label={`Max open positions (${tradingConfig.limits.max_open_positions.min}–${tradingConfig.limits.max_open_positions.max})`} value={draft.maxOpenPositions} onChange={(n) => setDraft({ ...draft, maxOpenPositions: n })} />
      <Field label={`Low-mcap % cap (${tradingConfig.limits.max_pct_low_mcap.min}–${tradingConfig.limits.max_pct_low_mcap.max})`} value={draft.maxPctLowMcap} onChange={(n) => setDraft({ ...draft, maxPctLowMcap: n })} />
      <Field label={`Daily loss % (${tradingConfig.limits.daily_loss_pct.min}–${tradingConfig.limits.daily_loss_pct.max})`} value={draft.dailyLossPct} onChange={(n) => setDraft({ ...draft, dailyLossPct: n })} />
      <Field label={`Cooldown minutes after a loss (${tradingConfig.limits.cooldown_after_loss_minutes.min}–${tradingConfig.limits.cooldown_after_loss_minutes.max})`} value={draft.cooldownAfterLossMinutes} onChange={(n) => setDraft({ ...draft, cooldownAfterLossMinutes: n })} />
      <Field label={`HIGH-risk % cap (${tradingConfig.limits.high_risk_max_pct.min}–${tradingConfig.limits.high_risk_max_pct.max})`} value={draft.highRiskMaxPct} onChange={(n) => setDraft({ ...draft, highRiskMaxPct: n })} />

      <h2 className="mt-2 text-sm font-medium">Alerts</h2>
      <p className="text-xs text-muted-foreground">In-app alerts fire once per event. Web push and email stay off until those providers are configured.</p>
      <Toggle label="New PASS coins" checked={alerts.passCoins} onChange={(v) => setAlerts({ ...alerts, passCoins: v })} />
      <Field label="Minimum PASS score" value={alerts.passScoreMin} onChange={(n) => setAlerts({ ...alerts, passScoreMin: n })} />
      <Toggle label="Stop and ladder hits" checked={alerts.stops} onChange={(v) => setAlerts({ ...alerts, stops: v })} />
      <Toggle label="Daily loss lock" checked={alerts.dailyLoss} onChange={(v) => setAlerts({ ...alerts, dailyLoss: v })} />
      <Toggle label="Held coin turns BLOCKED" checked={alerts.verdictChange} onChange={(v) => setAlerts({ ...alerts, verdictChange: v })} />
      <Toggle label="Web push (not configured)" checked={false} onChange={() => undefined} disabled />
      <Toggle label="Email (not configured)" checked={false} onChange={() => undefined} disabled />

      <Button type="button" disabled={!me || busy} onClick={() => void save()} className="w-fit">
        {busy ? "Saving…" : "Save settings"}
      </Button>
      {saved ? <p className="text-xs text-emerald-700">Saved. Limit values were clamped to the safe bounds.</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1"
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
