/** Display helpers. Unknown values render as a dash, never as 0. */

const DASH = "—";

export function fmtUsd(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (opts.compact !== false && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

/** Meme coin prices are often far below one cent; show enough significant digits to be meaningful. */
export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (value === 0) return "$0";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  const digits = Math.min(12, Math.max(4, -Math.floor(Math.log10(value)) + 3));
  return `$${value.toFixed(digits).replace(/0+$/, "")}`;
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function fmtAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function fmtNumber(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits }).format(value);
}
