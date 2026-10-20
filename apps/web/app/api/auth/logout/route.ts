import { jsonOk, withErrorBoundary } from "@/lib/api-response";
import { clearSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/auth/logout", async () => {
  await clearSessionCookie();
  return jsonOk({ ok: true });
});
