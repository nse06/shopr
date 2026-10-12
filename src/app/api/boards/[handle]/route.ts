import { authorized, unauthorized } from "@/lib/server/auth";
import { deleteBoard, isOwner, photoPrefix, readBoard, saveBoard } from "@/lib/server/boards";
import { badRequest, BoardUpdateSchema } from "@/lib/server/schemas";
import { guarded, handleFrom, notSetUp, ownerKey, problem } from "@/lib/server/sharing";
import { store } from "@/lib/server/storage";
import type { PublicBoard } from "@/lib/types";

type Ctx = { params: Promise<{ handle: string }> };

/** A public board (anyone). */
export async function GET(_req: Request, { params }: Ctx) {
  const off = notSetUp();
  if (off) return off;
  return guarded(async () => {
    const handle = handleFrom((await params).handle);
    const board = handle ? await readBoard(store(), handle) : null;
    if (!board) return problem("There's no board here.", 404);
    return Response.json({ board }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** Publish or update your board. */
export async function PUT(req: Request, { params }: Ctx) {
  if (!authorized(req)) return unauthorized();
  const off = notSetUp();
  if (off) return off;
  return guarded(async () => {
    const handle = handleFrom((await params).handle);
    const key = ownerKey(req);
    const s = store();
    if (!handle || !key || !(await isOwner(s, handle, key))) return problem("This board belongs to someone else.", 403);
    const parsed = BoardUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error);
    const { photos, ...meta } = parsed.data;
    if (photos.some((p) => !s.owns(p.url, photoPrefix(handle)))) return problem("Upload the photos before publishing.", 400);
    const before = await readBoard(s, handle);
    const now = Date.now();
    const board: PublicBoard = { handle, ...meta, photos, createdAt: before?.createdAt ?? now, updatedAt: now };
    await saveBoard(s, board);
    return Response.json({ board });
  });
}

/** Take your board down. */
export async function DELETE(req: Request, { params }: Ctx) {
  if (!authorized(req)) return unauthorized();
  const off = notSetUp();
  if (off) return off;
  return guarded(async () => {
    const handle = handleFrom((await params).handle);
    const key = ownerKey(req);
    const s = store();
    if (!handle || !key || !(await isOwner(s, handle, key))) return problem("This board belongs to someone else.", 403);
    await deleteBoard(s, handle);
    return Response.json({ ok: true });
  });
}
