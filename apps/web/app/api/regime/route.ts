import { regimeSnapshotSchema } from "@meme-guard/shared-types";
import { jsonOk, withErrorBoundary } from "@/lib/api-response";
import { latestRegimeSnapshot } from "@/lib/regime";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/regime", async () => {
  const snap = await latestRegimeSnapshot();
  return jsonOk(
    snap
      ? regimeSnapshotSchema.parse(snap)
      : { regime: "NEUTRAL", btcTrend: null, ethTrend: null, solTrend: null, memecoinVolumeIndex: null, avgPeakMcap: null, ts: new Date().toISOString() },
  );
});
