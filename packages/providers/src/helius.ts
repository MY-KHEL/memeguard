import { z } from "zod";
import { createProviderClient, type ProviderClient } from "./client";
import { fail, succeed, type ProviderDeps, type ProviderResult } from "./types";

/**
 * Helius JSON-RPC (standard Solana RPC plus DAS). Docs: https://www.helius.dev/docs
 * Auth is the api-key query parameter on https://mainnet.helius-rpc.com.
 * Phase 1 uses:
 *   - DAS getAsset         -> token metadata, supply, decimals, mint and freeze authority
 *   - getTokenLargestAccounts -> top 20 token accounts (holders list for the detail page)
 * Wallet age and funding source (Wallet API) arrive in Phase 2.
 *
 * Optional provider: without HELIUS_API_KEY every call returns not_configured,
 * which downstream must treat as UNVERIFIED, never as a pass.
 */

export const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com";
export const HELIUS_API_URL = "https://api.helius.xyz";
const LIMIT_PER_MINUTE = 300;

const rpcEnvelope = <T extends z.ZodTypeAny>(result: T) =>
  z.object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number()]).optional(),
    result: result.optional(),
    error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
  });

const assetResultSchema = z
  .object({
    id: z.string(),
    content: z
      .object({
        metadata: z.object({ name: z.string().nullable().optional(), symbol: z.string().nullable().optional() }).passthrough().optional(),
        links: z.object({ image: z.string().nullable().optional() }).passthrough().nullable().optional(),
        json_uri: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    authorities: z.array(z.object({ address: z.string(), scopes: z.array(z.string()).optional() })).optional(),
    mutable: z.boolean().optional(),
    burnt: z.boolean().optional(),
    token_info: z
      .object({
        supply: z.number().nullable().optional(),
        decimals: z.number().nullable().optional(),
        token_program: z.string().nullable().optional(),
        mint_authority: z.string().nullable().optional(),
        freeze_authority: z.string().nullable().optional(),
        price_info: z.object({ price_per_token: z.number().nullable().optional(), currency: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export interface HeliusAsset {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  /** Raw supply in base units, as a string to avoid float loss. */
  supplyRaw: string | null;
  decimals: number | null;
  /** Supply divided by 10^decimals. */
  supplyUi: number | null;
  tokenProgram: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mutable: boolean | null;
}

const largestAccountsSchema = z.object({
  context: z.object({ slot: z.number() }).passthrough().optional(),
  value: z.array(
    z.object({
      address: z.string(),
      amount: z.string(),
      decimals: z.number(),
      uiAmount: z.number().nullable(),
      uiAmountString: z.string().optional(),
    }),
  ),
});

export interface HeliusLargestAccount {
  /** Token account address (not the owner wallet). */
  tokenAccount: string;
  amountRaw: string;
  uiAmount: number | null;
  decimals: number;
}

export interface HeliusFirstTx {
  signature: string;
  timestamp: number | null;
  fundingSource: string | null;
}

export interface HeliusSwap {
  signature: string;
  timestamp: number | null;
  side: "buy" | "sell" | "unknown";
}

export interface HeliusProvider {
  isConfigured(): boolean;
  getAsset(mint: string): Promise<ProviderResult<HeliusAsset>>;
  getTokenLargestAccounts(mint: string): Promise<ProviderResult<HeliusLargestAccount[]>>;
  getFirstTransaction(address: string): Promise<ProviderResult<HeliusFirstTx | null>>;
  getSwaps(address: string, mint: string): Promise<ProviderResult<HeliusSwap[]>>;
}

export function createHelius(deps: ProviderDeps, client?: ProviderClient): HeliusProvider {
  const apiKey = deps.env.HELIUS_API_KEY;
  const configured = Boolean(apiKey);
  const notConfigured = <T>() => Promise.resolve(fail<T>("helius", "not_configured", "HELIUS_API_KEY is not set"));

  const http =
    client ??
    createProviderClient(
      {
        name: "helius",
        baseUrl: deps.env.HELIUS_RPC_URL ?? HELIUS_RPC_URL,
        rateLimitPerMinute: LIMIT_PER_MINUTE,
        timeoutMs: 8000,
      },
      deps,
    );

  const api = createProviderClient(
    {
      name: "helius",
      baseUrl: deps.env.HELIUS_API_URL ?? HELIUS_API_URL,
      rateLimitPerMinute: LIMIT_PER_MINUTE,
      timeoutMs: 8000,
    },
    deps,
  );

  async function rpc<T>(method: string, params: unknown, schema: z.ZodType<T>, cache: { parts: Array<string | number>; ttlSeconds: number }) {
    const res = await http.request({
      path: "/",
      method: "POST",
      query: { "api-key": apiKey },
      body: { jsonrpc: "2.0", id: "meme-guard", method, params },
      schema: rpcEnvelope(schema),
      cache: { parts: [method, ...cache.parts], ttlSeconds: cache.ttlSeconds },
    });
    if (!res.ok) return res as ProviderResult<T>;
    if (res.data.error || res.data.result === undefined) {
      const msg = res.data.error?.message ?? "empty result";
      const code = res.data.error?.code;
      const reason = code === -32029 ? "rate_limited" : /not found|does not exist|Invalid param/i.test(msg) ? "not_found" : "unavailable";
      return fail<T>("helius", reason, msg);
    }
    return succeed<T>("helius", res.data.result, res.fromCache);
  }

  return {
    isConfigured: () => configured,

    async getAsset(mint) {
      if (!configured) return notConfigured();
      const res = await rpc("getAsset", { id: mint }, assetResultSchema, { parts: [mint], ttlSeconds: 300 });
      if (!res.ok) return res;
      const a = res.data;
      const supply = a.token_info?.supply ?? null;
      const decimals = a.token_info?.decimals ?? null;
      return succeed(
        "helius",
        {
          mint: a.id,
          name: a.content?.metadata?.name ?? null,
          symbol: a.content?.metadata?.symbol ?? null,
          imageUrl: a.content?.links?.image ?? null,
          supplyRaw: supply === null ? null : String(supply),
          decimals,
          supplyUi: supply !== null && decimals !== null ? supply / 10 ** decimals : null,
          tokenProgram: a.token_info?.token_program ?? null,
          mintAuthority: a.token_info?.mint_authority ?? null,
          freezeAuthority: a.token_info?.freeze_authority ?? null,
          mutable: a.mutable ?? null,
        },
        res.fromCache,
      );
    },

    async getTokenLargestAccounts(mint) {
      if (!configured) return notConfigured();
      const res = await rpc("getTokenLargestAccounts", [mint], largestAccountsSchema, { parts: [mint], ttlSeconds: 60 });
      if (!res.ok) return res;
      return succeed(
        "helius",
        res.data.value.map((v) => ({ tokenAccount: v.address, amountRaw: v.amount, uiAmount: v.uiAmount, decimals: v.decimals })),
        res.fromCache,
      );
    },

    async getFirstTransaction(address) {
      if (!configured) return notConfigured();
      const res = await api.request({
        path: `/v0/addresses/${address}/transactions`,
        query: { "api-key": apiKey, "sort-order": "asc", limit: 1 },
        schema: enhancedTxArraySchema,
        cache: { parts: ["first-tx", address], ttlSeconds: 86_400 },
      });
      if (!res.ok) return res;
      const tx = res.data[0];
      if (!tx) return succeed("helius", null, res.fromCache);
      return succeed("helius", { signature: tx.signature, timestamp: tx.timestamp ?? null, fundingSource: fundingSourceFromTx(tx, address) }, res.fromCache);
    },

    async getSwaps(address, mint) {
      if (!configured) return notConfigured();
      const res = await api.request({
        path: `/v0/addresses/${address}/transactions`,
        query: { "api-key": apiKey, type: "SWAP", limit: 20 },
        schema: enhancedTxArraySchema,
        cache: { parts: ["swaps", address, mint], ttlSeconds: 300 },
      });
      if (!res.ok) return res;
      return succeed("helius", res.data.map((tx) => ({ signature: tx.signature, timestamp: tx.timestamp ?? null, side: swapSide(tx, mint) })), res.fromCache);
    },
  };
}

const enhancedTxSchema = z
  .object({
    signature: z.string(),
    timestamp: z.number().nullable().optional(),
    type: z.string().optional(),
    nativeTransfers: z
      .array(z.object({ fromUserAccount: z.string().nullable().optional(), toUserAccount: z.string().nullable().optional(), amount: z.number().optional() }))
      .optional(),
    tokenTransfers: z
      .array(
        z.object({
          mint: z.string().optional(),
          fromUserAccount: z.string().nullable().optional(),
          toUserAccount: z.string().nullable().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
const enhancedTxArraySchema = z.array(enhancedTxSchema);

export function fundingSourceFromTx(tx: z.infer<typeof enhancedTxSchema>, address: string): string | null {
  const inbound = (tx.nativeTransfers ?? []).find((t) => t.toUserAccount === address && t.fromUserAccount && t.fromUserAccount !== address);
  return inbound?.fromUserAccount ?? null;
}

export function swapSide(tx: z.infer<typeof enhancedTxSchema>, mint: string): "buy" | "sell" | "unknown" {
  const transfers = tx.tokenTransfers ?? [];
  const received = transfers.some((t) => t.mint === mint && t.toUserAccount);
  const sent = transfers.some((t) => t.mint === mint && t.fromUserAccount);
  if (received && !sent) return "buy";
  if (sent && !received) return "sell";
  return "unknown";
}
