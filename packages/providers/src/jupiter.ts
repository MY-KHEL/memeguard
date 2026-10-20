import { z } from "zod";
import { createProviderClient, type ProviderClient } from "./client";
import { succeed, type ProviderDeps, type ProviderResult } from "./types";

/**
 * Jupiter Swap API V2. Docs: https://developers.jup.ag/docs/swap/index.md
 * Sell simulation uses GET /swap/v2/order without a taker so we get a quote
 * and never a transaction to sign. Keyless access is 0.5 rps; a free key is 1 rps.
 */

export const JUPITER_BASE_URL = "https://api.jup.ag";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

const orderSchema = z
  .object({
    inputMint: z.string().optional(),
    outputMint: z.string().optional(),
    inAmount: z.string().optional(),
    outAmount: z.string().optional(),
    priceImpact: z.number().nullable().optional(),
    priceImpactPct: z.union([z.string(), z.number()]).nullable().optional(),
    routePlan: z
      .array(z.object({ swapInfo: z.object({ label: z.string().optional() }).passthrough().optional() }).passthrough())
      .optional(),
    errorCode: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    transaction: z.string().nullable().optional(),
  })
  .passthrough();

export interface JupiterSellQuote {
  quoted: boolean;
  priceImpactPct: number | null;
  outAmountLamports: string | null;
  inAmountLamports: string | null;
  routeLabels: string[];
  reason?: "no_route" | "error";
  code?: string;
}

export interface JupiterSwapQuote extends JupiterSellQuote {
  inputMint: string;
  outputMint: string;
}

export interface JupiterProvider {
  isConfigured(): boolean;
  quoteSwap(opts: { inputMint: string; outputMint: string; amountRaw: string; slippageBps?: number }): Promise<ProviderResult<JupiterSwapQuote>>;
  simulateSell(opts: { mint: string; amountRaw: string }): Promise<ProviderResult<JupiterSellQuote>>;
}

function impactPct(data: z.infer<typeof orderSchema>): number | null {
  if (typeof data.priceImpact === "number" && Number.isFinite(data.priceImpact)) return data.priceImpact;
  if (data.priceImpactPct === null || data.priceImpactPct === undefined) return null;
  const n = typeof data.priceImpactPct === "string" ? Number(data.priceImpactPct) : data.priceImpactPct;
  if (!Number.isFinite(n)) return null;
  // V1 used a 0–1 ratio named priceImpactPct; V2 prefers `priceImpact` already in percent.
  return n > 0 && n <= 1 ? n * 100 : n;
}

export function createJupiter(deps: ProviderDeps, client?: ProviderClient): JupiterProvider {
  const apiKey = deps.env.JUPITER_API_KEY;
  const http =
    client ??
    createProviderClient(
      {
        name: "jupiter",
        baseUrl: deps.env.JUPITER_BASE_URL ?? JUPITER_BASE_URL,
        rateLimitPerMinute: apiKey ? 60 : 30,
        timeoutMs: 8000,
        defaultHeaders: apiKey ? { "x-api-key": apiKey } : undefined,
      },
      deps,
    );

  return {
    isConfigured: () => Boolean(apiKey),

    async quoteSwap({ inputMint, outputMint, amountRaw, slippageBps = 100 }) {
      const res = await http.request({
        path: "/swap/v2/order",
        query: { inputMint, outputMint, amount: amountRaw, slippageBps },
        schema: orderSchema,
        cache: { parts: ["swap", inputMint, outputMint, amountRaw, String(slippageBps)], ttlSeconds: 15 },
      });
      if (!res.ok) return res;
      const d = res.data;
      const noRoute = Boolean(d.errorCode || d.errorMessage || d.error) || !d.outAmount;
      if (noRoute) {
        return succeed(
          "jupiter",
          {
            quoted: false,
            priceImpactPct: null,
            outAmountLamports: null,
            inAmountLamports: d.inAmount ?? amountRaw,
            routeLabels: [],
            inputMint,
            outputMint,
            reason: d.errorCode || d.errorMessage || d.error ? "error" : "no_route",
            code: d.errorCode ?? undefined,
          },
          res.fromCache,
        );
      }
      return succeed(
        "jupiter",
        {
          quoted: true,
          priceImpactPct: impactPct(d),
          outAmountLamports: d.outAmount ?? null,
          inAmountLamports: d.inAmount ?? amountRaw,
          routeLabels: (d.routePlan ?? []).map((r) => r.swapInfo?.label).filter((l): l is string => Boolean(l)),
          inputMint,
          outputMint,
        },
        res.fromCache,
      );
    },

    async simulateSell({ mint, amountRaw }) {
      return this.quoteSwap({ inputMint: mint, outputMint: SOL_MINT, amountRaw });
    },
  };
}
