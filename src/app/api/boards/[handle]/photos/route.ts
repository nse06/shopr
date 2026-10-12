import { authorized, unauthorized } from "@/lib/server/auth";
import { isOwner, MAX_STORED_PHOTOS, photoPath, photoPrefix } from "@/lib/server/boards";
import { sniffImage } from "@/lib/server/fetching";
import { guarded, handleFrom, notSetUp, ownerKey, problem } from "@/lib/server/sharing";
import { store } from "@/lib/server/storage";

type Ctx = { params: Promise<{ handle: string }> };

const MAX_BYTES = 3_000_000;

/** Upload one photo of your board (the body is the image itself). */
export async function POST(req: Request, { params }: Ctx) {
  if (!authorized(req)) return unauthorized();
  const off = notSetUp();
  if (off) return off;
  return guarded(async () => {
    const handle = handleFrom((await params).handle);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const key = ownerKey(req);
    const s = store();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return problem("Bad photo id.", 400);
    if (!handle || !key || !(await isOwner(s, handle, key))) return problem("This board belongs to someone else.", 403);
    if (Number(req.headers.get("content-length") || 0) > MAX_BYTES) return problem("That photo is too big.", 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return problem("That photo is too big.", 413);
    const type = sniffImage(bytes);
    if (!type) return problem("That isn't a photo.", 400);
    const stored = await s.list(photoPrefix(handle));
    if (stored.length >= MAX_STORED_PHOTOS && !stored.some((f) => f.pathname === photoPath(handle, id))) {
      return problem("That's more photos than a shared board can hold. Update your board, then try again.", 413);
    }
    const url = await s.writeFile(photoPath(handle, id), bytes, type);
    return Response.json({ url });
  });
}
