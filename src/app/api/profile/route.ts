import { authorized, unauthorized } from "@/lib/server/auth";
import { claudeConfigured, friendlyError } from "@/lib/server/claude";
import { readBoard } from "@/lib/server/profile";
import { badRequest, ProfileRequestSchema } from "@/lib/server/schemas";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (!claudeConfigured()) {
    return Response.json({ error: "setup", message: "Claude isn't connected yet. Add ANTHROPIC_API_KEY in Vercel." }, { status: 503 });
  }
  const parsed = ProfileRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const profile = await readBoard(parsed.data.board, parsed.data.prefs, req.signal);
    return Response.json({ profile });
  } catch (e) {
    if (!req.signal.aborted) console.error("board read failed", e);
    return Response.json({ error: "claude", message: friendlyError(e) }, { status: 502 });
  }
}
