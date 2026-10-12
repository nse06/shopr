import { authorized, unauthorized } from "@/lib/server/auth";
import { fetchPublic, previewImageFromHtml, sniffImage } from "@/lib/server/fetching";

// Turns a pasted link (a Pinterest pin, a shop page, a photo) into a photo for the moodboard.
export const maxDuration = 30;

const MAX_BYTES = 12_000_000;

function fail(message: string, status = 422): Response {
  return Response.json({ error: "import", message }, { status });
}

function photo(bytes: Uint8Array, type: string): Response {
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return fail("Paste a link first.", 400);

  try {
    const page = await fetchPublic(url, { maxBytes: MAX_BYTES, timeoutMs: 10_000, accept: "text/html,image/*;q=0.9,*/*;q=0.5", signal: req.signal });
    const direct = sniffImage(page.bytes);
    if (direct) return photo(page.bytes, direct);

    const html = new TextDecoder().decode(page.bytes.slice(0, 2_000_000));
    const preview = previewImageFromHtml(html, page.url);
    if (!preview) {
      return fail(
        /instagram\.com|tiktok\.com/i.test(page.url)
          ? "Instagram and TikTok hide their photos from other apps. Take a screenshot and add that instead."
          : "That page doesn't share a photo. Try a screenshot instead.",
      );
    }
    const image = await fetchPublic(preview, { maxBytes: MAX_BYTES, timeoutMs: 10_000, accept: "image/webp,image/jpeg,image/png,image/*;q=0.8", signal: req.signal });
    const type = sniffImage(image.bytes);
    if (!type) return fail("That page's photo is in a format shopr can't use. Try a screenshot instead.");
    return photo(image.bytes, type);
  } catch (e) {
    return fail(`Couldn't get a photo from that link. ${(e as Error).message}`.trim());
  }
}
