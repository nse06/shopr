// Small helpers shared by the public-board routes.

import { normalizeHandle, validKey } from "./boards";
import { storageConfigured } from "./storage";

export function notSetUp(): Response | null {
  return storageConfigured()
    ? null
    : Response.json(
        { error: "sharing", message: "Sharing isn't set up yet. In Vercel, open Storage, create a Blob store and connect it to this project, then redeploy." },
        { status: 503 },
      );
}

export function ownerKey(req: Request): string | null {
  const key = req.headers.get("x-owner-key");
  return validKey(key) ? key : null;
}

export function handleFrom(raw: string): string | null {
  try {
    return normalizeHandle(decodeURIComponent(raw));
  } catch {
    return null; // a malformed %-escape
  }
}

export function problem(message: string, status: number): Response {
  return Response.json({ error: "boards", message }, { status });
}

/** What to tell people when the Blob store fails, in plain words. */
export function storageProblem(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/private/i.test(message)) {
    return "Your Vercel Blob store is private, and shared boards need a public one. In Vercel, create a new Blob store with public access, connect it to this project, and redeploy.";
  }
  if (/suspended/i.test(message)) return "Your Vercel Blob store is suspended. Check Storage in Vercel.";
  if (/credentials|token|access denied/i.test(message)) {
    return "shopr can't get into your Vercel Blob store. Check that it's connected to this project in Vercel, then redeploy.";
  }
  return "Couldn't reach the shared boards just now. Try again.";
}

/** Run a route's work, turning a storage failure into a message people can act on. */
export async function guarded(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (e) {
    console.error("shared boards:", e);
    return problem(storageProblem(e), 502);
  }
}
