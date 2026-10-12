import { authorized, unauthorized } from "@/lib/server/auth";
import { claudeConfigured, friendlyError } from "@/lib/server/claude";
import { fetchPhoto, type Photo } from "@/lib/server/fetching";
import { badRequest, ChatSchema } from "@/lib/server/schemas";
import { runStylist } from "@/lib/server/stylist";
import type { ChatEvent } from "@/lib/types";

// A turn can take a minute or two: Claude thinks, searches, then looks at ~30 photos.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (!claudeConfigured()) {
    return Response.json({ error: "setup", message: "Claude isn't connected yet. Add ANTHROPIC_API_KEY in Vercel." }, { status: 503 });
  }
  const parsed = ChatSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  const { photo: attached, photoUrl, ...rest } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (line: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(line + "\n"));
        } catch {
          open = false; // the browser went away
        }
      };
      const send = (event: ChatEvent) => write(JSON.stringify(event));
      // A blank line now and then keeps quiet connections from being dropped.
      const heartbeat = setInterval(() => write(""), 10_000);
      try {
        let photo: Photo | null = attached ? { data: attached, mediaType: "image/jpeg" } : null;
        if (!photo && photoUrl) photo = await fetchPhoto(photoUrl, req.signal, "image/jpeg,image/png;q=0.9");
        const reply = await runStylist({ ...rest, photo }, send, req.signal);
        send({ type: "reply", ...reply });
      } catch (e) {
        if (!req.signal.aborted) console.error("chat turn failed", e);
        send({ type: "error", text: friendlyError(e) });
      } finally {
        clearInterval(heartbeat);
        open = false;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
