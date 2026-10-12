import { after } from "next/server";
import { OWN_BOARD, TEST_BOARDS, type BoardOutcome } from "@/lib/droptest";
import { authorized, unauthorized } from "@/lib/server/auth";
import { claudeConfigured, friendlyError } from "@/lib/server/claude";
import { logCost } from "@/lib/server/costlog";
import { Meter } from "@/lib/server/costs";
import { runOutcomes, saveOutcome, testBoard, testSampleBoard } from "@/lib/server/droptest";
import { badRequest, DropTestSchema, RUN_ID } from "@/lib/server/schemas";
import { storageConfigured, store } from "@/lib/server/storage";

// A board takes one to three minutes. It runs after the reply, so a phone going to
// sleep doesn't stop it, and its result is saved for the page to collect.
export const maxDuration = 300;
const DEADLINE_MS = 270_000; // stop in time to save what happened

/** The results saved so far for one test run. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const run = new URL(req.url).searchParams.get("run") ?? "";
  if (!RUN_ID.test(run)) return Response.json({ error: "bad_request", message: "Which test run?" }, { status: 400 });
  if (!storageConfigured()) return Response.json({ boards: {} });
  try {
    return Response.json({ boards: await runOutcomes(store(), run) });
  } catch (e) {
    console.error("couldn't load the drop test", e);
    return Response.json({ error: "storage", message: "Couldn't load the results just now." }, { status: 502 });
  }
}

/** Test one board: every setup picks a drop from the same listings, then the judge scores them. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  if (!claudeConfigured()) {
    return Response.json({ error: "setup", message: "Claude isn't connected yet. Add ANTHROPIC_API_KEY in Vercel." }, { status: 503 });
  }
  const parsed = DropTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  const { run, board, attempt, own } = parsed.data;
  const sample = TEST_BOARDS.find((b) => b.id === board);
  if (!sample && !(board === OWN_BOARD && own)) return Response.json({ error: "bad_request", message: "There's no test board by that name." }, { status: 400 });
  const title = sample?.title ?? "Your board";
  const saved = storageConfigured() ? store() : null;

  async function work(): Promise<BoardOutcome> {
    const meter = new Meter();
    const signal = AbortSignal.timeout(DEADLINE_MS);
    try {
      const ctx = { signal, meter, store: saved };
      const result = sample
        ? await testSampleBoard(sample, ctx)
        : await testBoard({ board: { id: OWN_BOARD, title }, photos: own!.board.map((data) => ({ data, mediaType: "image/jpeg" as const })), profile: own!.profile, prefs: own!.prefs }, ctx);
      meter.ok = true;
      return result;
    } catch (e) {
      if (!signal.aborted) console.error("drop test failed", e);
      return { board, title, error: signal.aborted ? "It took longer than 4½ minutes, so it was stopped." : friendlyError(e), at: Date.now() };
    } finally {
      await logCost(meter, "test");
    }
  }

  // Without a Blob store there's nowhere to leave the result, so it's sent back directly.
  if (!saved) return Response.json({ outcome: await work() });
  after(async () => {
    const outcome = await work();
    await saveOutcome(saved, run, attempt, outcome).catch((e) => console.error("couldn't save the drop test result", e));
  });
  return Response.json({ started: true }, { status: 202 });
}
