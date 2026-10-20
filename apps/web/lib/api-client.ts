import { z } from "zod";
import {
  appHealthSchema,
  candlesResponseSchema,
  holdersResponseSchema,
  tokenDetailSchema,
  riskReportSchema,
  tokenListResponseSchema,
  tradeCandidatesResponseSchema,
  meResponseSchema,
  quotePreviewSchema,
  portfolioResponseSchema,
  journalResponseSchema,
  type AppHealth,
  type CandleTimeframe,
  type CandlesResponse,
  type HoldersResponse,
  type RiskReportDto,
  type TokenDetail,
  type TokenListQuery,
  type TokenListResponse,
  type TradeCandidate,
  type SessionUser,
  type PaperBuyInput,
  type PaperSellInput,
  type QuotePreview,
  type PortfolioResponse,
  type LimitOverridesDto,
  type AlertPrefs,
  type NotificationDto,
  type RegimeSnapshotDto,
  type CalibrationReport,
  notificationsResponseSchema,
  regimeSnapshotSchema,
  calibrationReportSchema,
} from "@meme-guard/shared-types";

/**
 * Typed client for the web app's own API route handlers.
 * Every response is parsed with the shared zod schema, so UI code never
 * trusts an unvalidated payload.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T extends z.ZodTypeAny>(path: string, schema: T, init?: RequestInit): Promise<z.infer<T>> {
  const res = await fetch(path, { ...init, cache: "no-store", headers: { accept: "application/json", ...init?.headers } });
  const text = await res.text();
  let body: unknown;
  try {
    body = text.length ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, `Invalid JSON from ${path}`);
  }
  if (!res.ok && res.status !== 503) {
    const message =
      typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new ApiError(res.status, message || `Request to ${path} failed`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(res.status, `Unexpected response shape from ${path}`);
  }
  return parsed.data;
}

/** Build a query string from a partial token-list query, skipping empty values. */
export function tokenQueryString(q: Partial<TokenListQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: (): Promise<AppHealth> => request("/api/health", appHealthSchema),
  tokens: (q: Partial<TokenListQuery>, init?: RequestInit): Promise<TokenListResponse> =>
    request(`/api/tokens${tokenQueryString(q)}`, tokenListResponseSchema, init),
  token: (mint: string, init?: RequestInit): Promise<TokenDetail> =>
    request(`/api/tokens/${encodeURIComponent(mint)}`, tokenDetailSchema, init),
  candles: (mint: string, tf: CandleTimeframe, init?: RequestInit): Promise<CandlesResponse> =>
    request(`/api/tokens/${encodeURIComponent(mint)}/candles?tf=${tf}`, candlesResponseSchema, init),
  holders: (mint: string, init?: RequestInit): Promise<HoldersResponse> =>
    request(`/api/tokens/${encodeURIComponent(mint)}/holders`, holdersResponseSchema, init),
  risk: (mint: string, init?: RequestInit): Promise<RiskReportDto> =>
    request(`/api/tokens/${encodeURIComponent(mint)}/risk`, riskReportSchema, init),
  tradeCandidates: (init?: RequestInit): Promise<{ items: TradeCandidate[]; generatedAt: string }> =>
    request("/api/trade/candidates", tradeCandidatesResponseSchema, init),
  me: (): Promise<SessionUser> => request("/api/me", meResponseSchema),
  patchSettings: (body: { limits?: LimitOverridesDto; alerts?: Partial<AlertPrefs> }): Promise<SessionUser> =>
    request("/api/me/settings", meResponseSchema, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  notifications: (): Promise<{ items: NotificationDto[]; unread: number }> => request("/api/notifications", notificationsResponseSchema),
  markAllNotificationsRead: (): Promise<{ ok: boolean }> => request("/api/notifications", z.object({ ok: z.boolean() }), { method: "POST" }),
  markNotificationRead: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/notifications/${id}/read`, z.object({ ok: z.boolean() }), { method: "POST" }),
  regime: (): Promise<RegimeSnapshotDto> => request("/api/regime", regimeSnapshotSchema),
  calibration: (): Promise<CalibrationReport> => request("/api/calibration", calibrationReportSchema),
  authNonce: (wallet: string): Promise<{ wallet: string; nonce: string; issuedAt: string; message: string }> =>
    request(`/api/auth/nonce?wallet=${encodeURIComponent(wallet)}`, z.object({ wallet: z.string(), nonce: z.string(), issuedAt: z.string(), message: z.string() })),
  authVerify: (wallet: string, signature: string): Promise<{ userId: string; wallet: string }> =>
    request("/api/auth/verify", z.object({ userId: z.string(), wallet: z.string() }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, signature }),
    }),
  authDev: (): Promise<{ userId: string; wallet: string }> =>
    request("/api/auth/dev", z.object({ userId: z.string(), wallet: z.string() }), { method: "POST" }),
  logout: (): Promise<{ ok: boolean }> => request("/api/auth/logout", z.object({ ok: z.boolean() }), { method: "POST" }),
  tradePreview: (body: { mint: string; side: "buy" | "sell"; sizeSol?: number; tokenAmount?: number; fomoConfirmed?: boolean }): Promise<QuotePreview> =>
    request("/api/trade/preview", quotePreviewSchema, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  paperBuy: (body: PaperBuyInput): Promise<{ positionId: string }> =>
    request("/api/trade/paper/buy", z.object({ positionId: z.string() }), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  paperSell: (body: PaperSellInput): Promise<{ closed: boolean }> =>
    request("/api/trade/paper/sell", z.object({ closed: z.boolean() }), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  portfolio: (): Promise<PortfolioResponse> => request("/api/portfolio", portfolioResponseSchema),
  journal: (): Promise<{ items: Array<{ id: string; positionId: string | null; mint: string | null; symbol: string | null; thesis: string; outcomeNotes: string | null; mistakeTag: string | null; createdAt: string }> }> =>
    request("/api/journal", journalResponseSchema),
  patchJournal: (id: string, mistakeTag: string): Promise<{ id: string }> =>
    request(`/api/journal/${id}`, z.object({ id: z.string() }), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mistakeTag }) }),
  ackRecheck: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/positions/${id}/recheck`, z.object({ ok: z.boolean() }), { method: "POST" }),
};
