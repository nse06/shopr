import { after } from "next/server";
import { authorized, unauthorized } from "@/lib/server/auth";
import { claudeConfigured, friendlyError } from "@/lib/server/claude";
import { logCost } from "@/lib/server/costlog";
import { Meter } from "@/lib/server/costs";
import { runDrop } from "@/lib/server/drop";
import { badRequest, DropSchema } from "@/lib/server/schemas";

// One search round and one Claude call: usually 15 to 40 seconds.
export const maxDuration = 120;

/** Today's drop (round 0), another one or more in the same spirit (round 1, 2, ...). */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (!claudeConfigured()) {
    return Response.json({ error: "setup", message: "Claude isn't connected yet. Add ANTHROPIC_API_KEY in Vercel." }, { status: 503 });
  }
  const parsed = DropSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  const meter = new Meter();
  after(() => logCost(meter, parsed.data.more ? "more" : "drop"));
  try {
    const result = await runDrop(parsed.data, { signal: req.signal, meter });
    meter.ok = true;
    return Response.json(result);
  } catch (e) {
    if (!req.signal.aborted) console.error("drop failed", e);
    return Response.json({ error: "claude", message: friendlyError(e) }, { status: 502 });
  }
}
