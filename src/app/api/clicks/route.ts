import { authorized, unauthorized } from "@/lib/server/auth";
import { clickSummary } from "@/lib/server/clicklog";
import { guarded } from "@/lib/server/sharing";
import { storageConfigured, store } from "@/lib/server/storage";

/** Taps through to listings lately, for Settings. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (!storageConfigured()) return Response.json({ enabled: false });
  return guarded(async () => Response.json({ enabled: true, ...(await clickSummary(store())) }, { headers: { "Cache-Control": "no-store" } }));
}
