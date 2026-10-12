import { sniffImage } from "@/lib/server/fetching";
import { folderStore } from "@/lib/server/storage";

type Ctx = { params: Promise<{ path: string[] }> };

/** Serves files from the local folder store (development and tests only). */
export async function GET(_req: Request, { params }: Ctx) {
  const folder = folderStore();
  if (!folder) return new Response("Not found", { status: 404 });
  const pathname = (await params).path.join("/");
  const bytes = await folder.readFile(pathname);
  if (!bytes) return new Response("Not found", { status: 404 });
  const type = pathname.endsWith(".json") ? "application/json" : (sniffImage(bytes) ?? "application/octet-stream");
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
