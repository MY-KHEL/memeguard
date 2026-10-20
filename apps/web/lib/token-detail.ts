import { tokenDetailSchema, type TokenDetail } from "@meme-guard/shared-types";
import { getDb } from "./db";
import { getProviders } from "./providers";
import { getRecentSnapshots, getTokenRow, rowToListItem } from "./tokens-query";

/**
 * Token detail = tracked database row + on-demand Helius metadata (supply,
 * authorities). Helius being down or unconfigured is reported in `sources`,
 * never hidden, and the rest of the detail still returns.
 * Used by both the server page and the JSON route.
 */
export async function loadTokenDetail(mint: string): Promise<TokenDetail | null> {
  const { db } = getDb();
  const row = await getTokenRow(db, mint);
  if (!row) return null;

  const [snapshots, asset] = await Promise.all([getRecentSnapshots(db, mint), getProviders().helius.getAsset(mint)]);
  const base = rowToListItem(row);
  return tokenDetailSchema.parse({
    ...base,
    symbol: base.symbol ?? (asset.ok ? asset.data.symbol : null),
    name: base.name ?? (asset.ok ? asset.data.name : null),
    imageUrl: base.imageUrl ?? (asset.ok ? asset.data.imageUrl : null),
    creatorWallet: null,
    supplyUi: asset.ok ? asset.data.supplyUi : null,
    decimals: asset.ok ? asset.data.decimals : null,
    mintAuthority: asset.ok ? asset.data.mintAuthority : null,
    freezeAuthority: asset.ok ? asset.data.freezeAuthority : null,
    quoteSymbol: null,
    snapshots,
    sources: { metadata: asset.ok ? "helius" : base.symbol ? "dexscreener" : "none" },
  } satisfies TokenDetail);
}
