"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { call, dropBoardPhotos, failure, Locked } from "@/lib/client/api";
import { getState, useApp } from "@/lib/client/store";
import {
  failed,
  OWN_BOARD,
  outcomeKey,
  reportText,
  sharedWithFull,
  summarize,
  TEST_BOARDS,
  TEST_SETUPS,
  usdText,
  type BoardOutcome,
  type BoardResult,
} from "@/lib/droptest";

// --- The run, kept in this browser so leaving the page or a sleeping phone doesn't lose it ---

type Job = { status: "waiting" | "running" | "done"; attempt: number; startedAt?: number; outcome?: BoardOutcome };
type Run = { id: string; at: number; order: string[]; jobs: Record<string, Job>; paused: boolean };

const KEY = "shopr-droptest";
const AT_ONCE = 2; // boards tested at the same time: each makes five Claude calls
const CHECK_EVERY_MS = 6000;
const GIVE_UP_MS = 6 * 60_000; // the server stops a board after 4½ minutes

let run: Run | null | undefined; // undefined until read from storage
const listeners = new Set<() => void>();

function current(): Run | null {
  if (run === undefined) {
    try {
      run = JSON.parse(localStorage.getItem(KEY) ?? "null") as Run | null;
    } catch {
      run = null;
    }
  }
  return run;
}

function setRun(next: Run | null) {
  run = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // private browsing: the run just won't survive a reload
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function update(runId: string, change: (r: Run) => Run) {
  const r = current();
  if (r?.id === runId) setRun(change(r));
}

const setJob = (runId: string, board: string, job: Job) => update(runId, (r) => ({ ...r, jobs: { ...r.jobs, [board]: job } }));

const titleOf = (board: string) => (board === OWN_BOARD ? "Your board" : (TEST_BOARDS.find((b) => b.id === board)?.title ?? board));
const boardsWith = (r: Run, status: Job["status"]) => r.order.filter((b) => r.jobs[b]?.status === status);

let timer: ReturnType<typeof setInterval> | null = null;

/** Start boards while there's room, and keep checking on the ones running. */
function pump() {
  const r = current();
  if (r && !r.paused) {
    const room = AT_ONCE - boardsWith(r, "running").length;
    for (const board of boardsWith(r, "waiting").slice(0, Math.max(0, room))) start(r.id, board);
  }
  const after = current();
  const busy = !!after && boardsWith(after, "running").length > 0;
  if (busy && !timer) timer = setInterval(check, CHECK_EVERY_MS);
  if (!busy && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function finish(runId: string, board: string, attempt: number, outcome: BoardOutcome) {
  const job = current()?.jobs[board];
  if (current()?.id !== runId || job?.status !== "running" || job.attempt !== attempt) return;
  setJob(runId, board, { ...job, status: "done", outcome });
  pump();
}

async function start(runId: string, board: string) {
  const attempt = current()?.jobs[board]?.attempt ?? 1;
  setJob(runId, board, { status: "running", attempt, startedAt: Date.now() });
  const fail = (error: string) => finish(runId, board, attempt, { board, title: titleOf(board), error, at: Date.now() });
  const body: Record<string, unknown> = { run: runId, board, attempt };
  if (board === OWN_BOARD) {
    const s = getState();
    if (!s.profile) return fail("Your board hasn't been read yet. Open For you, then try again.");
    body.own = { profile: s.profile.profile, board: dropBoardPhotos(s.board, s.profile, 16), prefs: s.prefs };
  }
  try {
    const res = await call("/api/droptest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 202) return; // it runs on the server; check() collects the result
    if (!res.ok) return fail(await failure(res));
    finish(runId, board, attempt, ((await res.json()) as { outcome: BoardOutcome }).outcome);
  } catch (e) {
    if (e instanceof Locked) {
      update(runId, (r) => ({ ...r, paused: true, jobs: { ...r.jobs, [board]: { status: "waiting", attempt } } }));
      return pump();
    }
    // Otherwise the connection dropped, maybe after the board had started: check() finds out.
  }
}

async function check() {
  const r = current();
  const running = r ? boardsWith(r, "running") : [];
  if (!r || !running.length) return pump();
  try {
    const res = await call(`/api/droptest?run=${r.id}`, { cache: "no-store" });
    const { boards } = res.ok ? ((await res.json()) as { boards: Record<string, BoardOutcome> }) : { boards: {} as Record<string, BoardOutcome> };
    for (const board of running) {
      const job = r.jobs[board];
      const outcome = boards[outcomeKey(board, job.attempt)];
      if (outcome) finish(r.id, board, job.attempt, outcome);
      else if (Date.now() - (job.startedAt ?? 0) > GIVE_UP_MS) {
        finish(r.id, board, job.attempt, { board, title: titleOf(board), error: "It didn't finish. Try it again.", at: Date.now() });
      }
    }
  } catch {
    // offline for a moment: try again next time
  }
  pump();
}

function runTest(includeOwn: boolean) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const order = [...(includeOwn ? [OWN_BOARD] : []), ...TEST_BOARDS.map((b) => b.id)];
  setRun({ id, at: Date.now(), order, jobs: Object.fromEntries(order.map((b) => [b, { status: "waiting", attempt: 1 }])), paused: false });
  pump();
}

function setPaused(paused: boolean) {
  const r = current();
  if (!r) return;
  update(r.id, (x) => ({ ...x, paused }));
  pump();
}

function retry(board: string) {
  const r = current();
  const job = r?.jobs[board];
  if (!r || !job) return;
  update(r.id, (x) => ({ ...x, paused: false, jobs: { ...x.jobs, [board]: { status: "waiting", attempt: job.attempt + 1 } } }));
  pump();
}

// --- The page ---

const secs = (ms: number) => `${Math.round(ms / 1000)}s`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function BoardRow({ board, job, now }: { board: string; job: Job; now: number }) {
  let state: React.ReactNode;
  if (job.status === "waiting") state = <span className="muted">Waiting</span>;
  else if (job.status === "running") {
    state = (
      <span className="thinking">
        <span>Working {job.startedAt && now > job.startedAt ? clock(now - job.startedAt) : ""}</span>
      </span>
    );
  } else if (!job.outcome || failed(job.outcome)) {
    state = (
      <span>
        <span className="muted">{job.outcome?.error ?? "It didn't finish."} </span>
        <button type="button" className="text-btn" onClick={() => retry(board)}>
          Try again
        </button>
      </span>
    );
  } else {
    const result = job.outcome;
    state = (
      <span className="muted">
        {result.setups.map((s) => `${s.setup} ${s.error ? "failed" : (s.score ?? "?")}`).join(" · ")}
      </span>
    );
  }
  return (
    <li>
      <b>{titleOf(board)}</b>
      {state}
    </li>
  );
}

function BoardDetails({ result }: { result: BoardResult }) {
  return (
    <details className="droptest-board">
      <summary>
        <b>{result.title}</b> <span className="muted">“{result.headline}”</span>
      </summary>
      <p className="muted">
        Searched {result.searches.map((q) => `“${q}”`).join(", ")}: {result.candidates} listings to choose from.
        {result.problems.length ? ` ${result.problems.join(" ")}` : ""}
      </p>
      {result.judgeError && <p className="muted">The judge didn&apos;t answer: {result.judgeError}</p>}
      {result.setups.map((s) => {
        const shared = sharedWithFull(result, s.setup);
        return (
          <div key={s.setup} className="droptest-set">
            <p>
              <b>{TEST_SETUPS.find((t) => t.id === s.setup)?.label ?? s.setup}</b>{" "}
              {s.error
                ? `didn't answer: ${s.error}`
                : `${s.score ?? "?"}/10 · ${usdText(s.usd)} · ${secs(s.ms)}${shared == null ? "" : ` · ${shared} of its picks also in full detail`}`}
            </p>
            {s.why && <p className="muted">{s.why}</p>}
            {s.picks.length > 0 && (
              <div className="droptest-thumbs">
                {s.picks.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} src={p.thumb} alt={p.title} title={`${p.title} (${p.price}, ${p.source})`} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}

export function DropTest() {
  const r = useSyncExternalStore(subscribe, current, () => null);
  const { loaded, board, profile, status } = useApp();
  const [includeOwn, setIncludeOwn] = useState(true);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const [now, setNow] = useState(0);

  const running = r ? boardsWith(r, "running").length : 0;
  const waiting = r ? boardsWith(r, "waiting").length : 0;
  const finished = !!r && !running && !waiting;

  // Carry on with a run from before (a reload, or coming back to the page).
  useEffect(() => pump(), []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const canOwn = loaded && !!profile && board.length >= 3;
  const outcomes = r ? r.order.flatMap((b) => r.jobs[b]?.outcome ?? []) : [];
  const results = outcomes.filter((o): o is BoardResult => !failed(o));
  const report = results.length ? reportText(outcomes) : "";

  function begin() {
    if (r && !confirmAgain) return setConfirmAgain(true);
    setConfirmAgain(false);
    setCopied(null);
    runTest(canOwn && includeOwn);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied("yes");
    } catch {
      setCopied("no"); // show the text to copy by hand
    }
  }

  return (
    <main className="page settings droptest">
      <header className="page-head">
        <div>
          <h1 className="display display--page">Drop test</h1>
          <p className="sub lede">Which model should pick the daily drops? This tries four ways on the same listings, then a judge scores them.</p>
        </div>
      </header>

      <section>
        <div>
          <h2 className="section-title">What it tries</h2>
          <p className="muted">
            Each board gets one search of today&apos;s listings. Every setup picks a drop from them, then Opus scores the nine you&apos;d see on For you,
            from 1 to 10, without knowing which setup picked them.
          </p>
        </div>
        <ul className="cost-kinds">
          {TEST_SETUPS.map((s) => (
            <li key={s.id}>
              <b>{s.label}</b>: {s.effort} effort; sees {s.boardPhotos === 16 ? "up to 16" : s.boardPhotos} board photos and {s.candidates} listings at {s.photoSide}{" "}
              pixels
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div>
          <h2 className="section-title">Run it</h2>
          <p className="muted">
            About $3 in all on your Claude and Apify accounts, and around 10 minutes. Two boards run at a time. You can leave this page: come back and it picks up
            where it left off.
          </p>
        </div>
        <div className="droptest-run">
          {status && !status.claude && (
            <p className="muted">
              Connect Claude first (see <Link href="/settings">Settings</Link>).
            </p>
          )}
          {canOwn && (!r || finished) && (
            <label className="droptest-own">
              <input type="checkbox" checked={includeOwn} onChange={(e) => setIncludeOwn(e.target.checked)} />
              Include your own board
            </label>
          )}
          <div className="droptest-actions">
            {(!r || finished) && (
              <button type="button" className="btn" onClick={begin} disabled={!status?.claude}>
                {!r ? "Run the test" : confirmAgain ? "Tap again: this replaces the results" : "Run it again"}
              </button>
            )}
            {r && !finished && r.paused && (
              <button type="button" className="btn" onClick={() => setPaused(false)}>
                Carry on ({waiting} board{waiting === 1 ? "" : "s"} left)
              </button>
            )}
            {r && !finished && !r.paused && waiting > 0 && (
              <button type="button" className="text-btn" onClick={() => setPaused(true)}>
                Pause after these
              </button>
            )}
            {r && (
              <span className="muted">
                {r.order.length - waiting - running} of {r.order.length} boards done
              </span>
            )}
          </div>
          {r && (
            <ul className="droptest-boards">
              {r.order.map((b) => (
                <BoardRow key={b} board={b} job={r.jobs[b] ?? { status: "waiting", attempt: 1 }} now={now} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {results.length > 0 && (
        <section>
          <div>
            <h2 className="section-title">Results</h2>
            <p className="muted">
              Averages over {results.length} board{results.length === 1 ? "" : "s"}. The cost is the Claude call that picks a drop; the search and the judge are the
              same for all four.
            </p>
          </div>
          <div className="costs">
            <div className="cost-totals droptest-scores">
              {summarize(results).map((s) => (
                <div key={s.setup.id}>
                  <span className="label">{s.setup.label}</span>
                  <strong>{s.score == null ? "–" : s.score.toFixed(1)}</strong>
                  <span className="muted">{s.usd == null ? "No answers" : `${usdText(s.usd)} a drop · ${secs(s.ms ?? 0)}`}</span>
                  {s.shared != null && <span className="muted">{s.shared.toFixed(1)} picks in common with full detail</span>}
                </div>
              ))}
            </div>
            <div className="droptest-actions">
              <button type="button" className="btn" onClick={copy}>
                Copy results for Claude
              </button>
              {copied === "yes" && <span className="muted">Copied. Paste it into your chat with Claude.</span>}
            </div>
            {copied === "no" && (
              <>
                <p className="muted">Couldn&apos;t copy by itself. Select all of this and copy it:</p>
                <textarea className="droptest-text" readOnly value={report} rows={10} onFocus={(e) => e.currentTarget.select()} />
              </>
            )}
            <div>
              {results.map((result) => (
                <BoardDetails key={result.board} result={result} />
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
