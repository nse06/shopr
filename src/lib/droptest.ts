// The drop test: four ways of making a daily drop, tried on the same listings for the
// same boards, then scored by a judge who doesn't know which set came from which. The
// test page and the server share these.

import BOARDS from "./droptest-boards.json";

export type TestSetup = {
  id: string;
  label: string;
  model: string;
  effort: "low" | "medium" | "high";
  boardPhotos: number;
  photoSide: number; // long side of every photo it sees, in pixels
  candidates: number;
};

// The first is roughly what picking from the board costs today; the other three are the
// cheaper drop (see dropSetup) on each model.
export const TEST_SETUPS: TestSetup[] = [
  { id: "full", label: "Opus 5.5, full detail (like today)", model: "claude-opus-5-5", effort: "medium", boardPhotos: 16, photoSide: 512, candidates: 24 },
  { id: "opus", label: "Opus 5.5, cheaper drop", model: "claude-opus-5-5", effort: "low", boardPhotos: 8, photoSide: 384, candidates: 20 },
  { id: "sonnet", label: "Sonnet 5.5, cheaper drop", model: "claude-sonnet-5-5", effort: "low", boardPhotos: 8, photoSide: 384, candidates: 20 },
  { id: "haiku", label: "Haiku 5.5, cheaper drop", model: "claude-haiku-5-5", effort: "low", boardPhotos: 8, photoSide: 384, candidates: 20 },
];

export type TestBoard = { id: string; title: string; photos: string[] };

/** Sample boards, eight shop photos each, for styles a drop should tell apart. */
export const TEST_BOARDS: TestBoard[] = BOARDS;

export const OWN_BOARD = "own";

export type PickSummary = { id: string; title: string; price: string; source: string; thumb: string };

export type SetupResult = {
  setup: string;
  picks: PickSummary[];
  note: string;
  usd: number; // what its Claude call cost
  ms: number;
  tokensIn: number;
  tokensOut: number;
  score: number | null; // the judge's, 1 to 10
  why: string;
  error?: string;
};

export type BoardResult = {
  board: string;
  title: string;
  headline: string;
  searches: string[];
  candidates: number;
  setups: SetupResult[];
  judgeUsd: number;
  judgeError?: string;
  readUsd: number; // reading the board, the first time it's tested
  depopUsd: number;
  problems: string[];
  at: number;
};

export type BoardFailure = { board: string; title: string; error: string; at: number };
export type BoardOutcome = BoardResult | BoardFailure;

/** Results are kept by "board:attempt", so a board tried again doesn't pick up its last failure. */
export const outcomeKey = (board: string, attempt: number) => `${board}:${attempt}`;

export const failed = (o: BoardOutcome): o is BoardFailure => "error" in o && !("setups" in o);

/** How many of a setup's picks the full-detail setup also picked. */
export function sharedWithFull(result: BoardResult, setup: string): number | null {
  const full = result.setups.find((s) => s.setup === "full" && !s.error);
  const mine = result.setups.find((s) => s.setup === setup && !s.error);
  if (!full || !mine || setup === "full") return null;
  const ids = new Set(full.picks.map((p) => p.id));
  return mine.picks.filter((p) => ids.has(p.id)).length;
}

export type SetupSummary = {
  setup: TestSetup;
  boards: number; // boards where it answered
  score: number | null; // average
  usd: number | null; // average per drop
  ms: number | null;
  shared: number | null; // average picks in common with full detail
  best: number; // boards where it scored highest (ties count for each)
};

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(results: BoardResult[]): SetupSummary[] {
  return TEST_SETUPS.map((setup) => {
    const rows = results.flatMap((r) => r.setups.filter((s) => s.setup === setup.id && !s.error));
    const best = results.filter((r) => {
      const mine = r.setups.find((s) => s.setup === setup.id)?.score;
      return mine != null && mine === Math.max(...r.setups.map((s) => s.score ?? 0));
    }).length;
    return {
      setup,
      boards: rows.length,
      score: average(rows.flatMap((s) => (s.score == null ? [] : [s.score]))),
      usd: average(rows.map((s) => s.usd)),
      ms: average(rows.map((s) => s.ms)),
      shared: average(results.flatMap((r) => sharedWithFull(r, setup.id) ?? [])),
      best,
    };
  });
}

/** "4.2¢" or "$1.20". */
export function usdText(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  const cents = usd * 100;
  return cents >= 10 ? `${Math.round(cents)}¢` : `${cents.toFixed(cents >= 1 ? 1 : 2)}¢`;
}

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

/** The whole test as plain text, to paste back to Claude. */
export function reportText(outcomes: BoardOutcome[], day = new Date().toISOString().slice(0, 10)): string {
  const results = outcomes.filter((o): o is BoardResult => !failed(o));
  const lines = [`shopr drop test, ${day}: ${results.length} board${results.length === 1 ? "" : "s"} done`, "", "Average per drop:"];
  for (const s of summarize(results)) {
    if (!s.boards) {
      lines.push(`- ${s.setup.label}: no answers`);
      continue;
    }
    const bits = [
      s.score == null ? "not scored" : `score ${s.score.toFixed(1)}/10`,
      `Claude ${usdText(s.usd ?? 0)}`,
      seconds(s.ms ?? 0),
      `best on ${s.best} of ${results.length}`,
    ];
    if (s.shared != null) bits.push(`${s.shared.toFixed(1)} picks in common with full detail`);
    lines.push(`- ${s.setup.label}: ${bits.join(", ")}`);
  }
  if (results.length) {
    const each = (f: (r: BoardResult) => number) => usdText(results.reduce((n, r) => n + f(r), 0) / results.length);
    lines.push(`Shared by all four, per board: Depop ${each((r) => r.depopUsd)}, judge ${each((r) => r.judgeUsd)}, first read of a board ${each((r) => r.readUsd)}.`);
  }
  for (const r of results) {
    lines.push("", `${r.title}: "${r.headline}". Searches: ${r.searches.map((q) => `"${q}"`).join(", ")}. ${r.candidates} candidates.`);
    if (r.judgeError) lines.push(`  Judge failed: ${r.judgeError}`);
    for (const s of r.setups) {
      if (s.error) {
        lines.push(`  ${s.setup}: failed (${s.error})`);
        continue;
      }
      const shared = sharedWithFull(r, s.setup);
      lines.push(
        `  ${s.setup}: ${s.score ?? "?"}/10, ${usdText(s.usd)}, ${seconds(s.ms)}, ${s.tokensIn} in / ${s.tokensOut} out${shared == null ? "" : `, ${shared} shared`}. ${s.why}`,
        `    picks: ${s.picks.map((p) => `${p.title.slice(0, 48)} (${p.price})`).join(" | ") || "none"}`,
      );
    }
    if (r.problems.length) lines.push(`  Problems: ${r.problems.join(" ")}`);
  }
  for (const f of outcomes.filter(failed)) lines.push("", `${f.title}: failed (${f.error})`);
  return lines.join("\n");
}
