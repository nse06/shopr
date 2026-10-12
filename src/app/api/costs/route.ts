import { authorized, unauthorized } from "@/lib/server/auth";
import { costSummary } from "@/lib/server/costlog";
import { guarded } from "@/lib/server/sharing";
import { storageConfigured, store } from "@/lib/server/storage";

/** What shopr has cost to run lately (estimates), for Settings. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (!storageConfigured()) return Response.json({ enabled: false });
  return guarded(async () => Response.json({ enabled: true, ...(await costSummary(store())) }, { headers: { "Cache-Control": "no-store" } }));
}
