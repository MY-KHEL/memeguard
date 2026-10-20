import { jsonOk, withErrorBoundary } from "@/lib/api-response";
import { loadTradeCandidates } from "@/lib/trade-candidates";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/trade/candidates", async () => jsonOk(await loadTradeCandidates()));
