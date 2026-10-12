import { after } from "next/server";
import { logClick } from "@/lib/server/clicklog";
import { allowedDestination, tagged } from "@/lib/server/links";
import { normalizeHandle } from "@/lib/server/boards";
import type { ClickWhere } from "@/lib/types";

const WHERE = new Set<ClickWhere>(["home", "more", "saved", "elsewhere"]);

/**
 * A tap on a listing: count it, add shopr's referral tags, and send the person on.
 * Only to the marketplaces and shops shopr searches, never anywhere else.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const destination = allowedDestination(q.get("u") ?? "");
  if (!destination) return new Response("That isn't a link shopr sends people to.", { status: 400 });

  const via = normalizeHandle(q.get("v") ?? "");
  const where = q.get("w") as ClickWhere;
  const price = Number(q.get("p"));
  after(() =>
    logClick({
      at: Date.now(),
      source: (q.get("s") ?? destination.hostname).slice(0, 60),
      title: (q.get("t") ?? "").slice(0, 140),
      priceUsd: q.get("p") && Number.isFinite(price) ? Math.round(price) : null,
      via,
      where: WHERE.has(where) ? where : "home",
    }),
  );
  return new Response(null, {
    status: 302,
    headers: { Location: tagged(destination, via).toString(), "Cache-Control": "no-store", "Referrer-Policy": "origin" },
  });
}
