import { authorized, passwordRequired } from "@/lib/server/auth";
import { claudeConfigured } from "@/lib/server/claude";
import { ebayConfigured } from "@/lib/server/ebay";
import { SHOPS } from "@/lib/server/shops";
import type { Status } from "@/lib/types";

export async function GET(req: Request) {
  const status: Status = {
    claude: claudeConfigured(),
    ebay: ebayConfigured(),
    shops: SHOPS.length,
    passwordRequired: passwordRequired(),
    authorized: authorized(req),
  };
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
