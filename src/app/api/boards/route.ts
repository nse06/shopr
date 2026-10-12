import { authorized, unauthorized } from "@/lib/server/auth";
import { claimHandle, isReserved, normalizeHandle, searchBoards } from "@/lib/server/boards";
import { badRequest, ClaimSchema } from "@/lib/server/schemas";
import { guarded, notSetUp, ownerKey, problem } from "@/lib/server/sharing";
import { store } from "@/lib/server/storage";

/** Search public boards (anyone). */
export async function GET(req: Request) {
  const off = notSetUp();
  if (off) return off;
  return guarded(async () => {
    const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
    const boards = await searchBoards(store(), q);
    return Response.json({ boards }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** Claim a handle for this device's owner key. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const off = notSetUp();
  if (off) return off;
  return guarded(async () => {
    const key = ownerKey(req);
    if (!key) return problem("Missing the board key.", 400);
    const parsed = ClaimSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error);
    if (isReserved(parsed.data.handle)) return problem("That handle is taken. Try another.", 409);
    const handle = normalizeHandle(parsed.data.handle);
    if (!handle) return problem("Handles are 2 to 24 letters, numbers, dots or underscores.", 400);
    const result = await claimHandle(store(), handle, key);
    if (result === "taken") return problem(`@${handle} is taken. Try another.`, 409);
    return Response.json({ handle, status: result });
  });
}
