import { desc } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import type { Regime, RegimeSnapshotDto } from "@meme-guard/shared-types";
import { getDb } from "./db";

export async function latestRegimeSnapshot(): Promise<RegimeSnapshotDto | null> {
  const { db } = getDb();
  const [row] = await db.select().from(schema.regimeSnapshots).orderBy(desc(schema.regimeSnapshots.ts)).limit(1);
  if (!row) return null;
  return {
    regime: row.regime,
    btcTrend: row.btcTrend,
    ethTrend: row.ethTrend,
    solTrend: row.solTrend,
    memecoinVolumeIndex: row.memecoinVolumeIndex === null ? null : Number(row.memecoinVolumeIndex),
    avgPeakMcap: row.avgPeakMcap === null ? null : Number(row.avgPeakMcap),
    ts: row.ts.toISOString(),
  };
}

export async function latestRegime(): Promise<Regime | null> {
  const snap = await latestRegimeSnapshot();
  return snap?.regime ?? null;
}
