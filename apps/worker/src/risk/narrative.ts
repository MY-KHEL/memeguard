import { and, gt, ne, or, sql } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";

/** Lowercase, trimmed, internal spaces collapsed. Labels shorter than 2 characters do not count. */
export function normalizeNarrativeLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  return text.length >= 2 ? text : null;
}

/** Other mints that share this name or symbol and appeared inside the window. Null when there is nothing to match. */
export async function countSameNamePeers(
  db: Database,
  mint: string,
  name: string | null,
  symbol: string | null,
  since: Date,
): Promise<number | null> {
  const normName = normalizeNarrativeLabel(name);
  const normSymbol = normalizeNarrativeLabel(symbol);
  if (!normName && !normSymbol) return null;

  const folded = (column: typeof schema.tokens.name | typeof schema.tokens.symbol) =>
    sql`lower(regexp_replace(trim(coalesce(${column}, '')), '[[:space:]]+', ' ', 'g'))`;
  const nameMatch = normName ? sql`${folded(schema.tokens.name)} = ${normName}` : undefined;
  const symbolMatch = normSymbol ? sql`${folded(schema.tokens.symbol)} = ${normSymbol}` : undefined;
  const label = nameMatch && symbolMatch ? or(nameMatch, symbolMatch) : (nameMatch ?? symbolMatch);

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(and(ne(schema.tokens.mint, mint), gt(sql`coalesce(${schema.tokens.createdAt}, ${schema.tokens.firstSeenAt})`, since), label));

  return Number(row?.n ?? 0);
}
