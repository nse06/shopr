import { authorized, passwordRequired } from "@/lib/server/auth";
import { claudeConfigured } from "@/lib/server/claude";
import { depopConfigured } from "@/lib/server/depop";
import { ebayConfigured } from "@/lib/server/ebay";
import { storageConfigured } from "@/lib/server/storage";
import { SHOPS } from "@/lib/server/shops";
import type { Status } from "@/lib/types";

export async function GET(req: Request) {
  const status: Status = {
    claude: claudeConfigured(),
    ebay: ebayConfigured(),
    depop: depopConfigured(),
    sharing: storageConfigured(),
    referrals: Boolean(process.env.EBAY_CAMPAIGN_ID),
    shops: SHOPS.length,
    passwordRequired: passwordRequired(),
    authorized: authorized(req),
  };
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
