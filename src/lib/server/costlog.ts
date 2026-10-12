// A running tally of what shopr costs, kept in the Blob store: one file per month with
// totals per day and the latest requests.

import type { CostEntry, CostKind, CostSummary, CostTotals } from "../types";
import type { Meter } from "./costs";
import { privateFolder, storageConfigured, store, updateJson, type Store } from "./storage";

type KindDay = { n: number; claudeUsd: number; depopUsd: number; input: number; output: number; cacheRead: number; listings: number };
type Month = { days: Record<string, Partial<Record<CostKind, KindDay>>>; recent: CostEntry[] };

const DAY = 86_400_000;
const RECENT = 40;
const round = (n: number) => Math.round(n * 1e5) / 1e5;

const monthPath = (at: number) => `${privateFolder("costs")}/${new Date(at).toISOString().slice(0, 7)}.json`;
const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Add one request to this month's tally. */
export async function recordCost(s: Store, meter: Meter, kind: CostKind, at = Date.now()): Promise<void> {
  const entry: CostEntry = { at, kind, usd: round(meter.usd), claudeUsd: round(meter.claude.usd), depopUsd: round(meter.depop.usd), ok: meter.ok };
  await updateJson<Month>(s, monthPath(at), () => ({ days: {}, recent: [] }), (month) => {
    const day = (month.days[dayKey(at)] ??= {});
    const k = (day[kind] ??= { n: 0, claudeUsd: 0, depopUsd: 0, input: 0, output: 0, cacheRead: 0, listings: 0 });
    k.n++;
    k.claudeUsd = round(k.claudeUsd + meter.claude.usd);
    k.depopUsd = round(k.depopUsd + meter.depop.usd);
    k.input += meter.claude.input + meter.claude.cacheWrite;
    k.output += meter.claude.output;
    k.cacheRead += meter.claude.cacheRead;
    k.listings += meter.depop.listings;
    month.recent = [entry, ...month.recent].slice(0, RECENT);
    return month;
  });
}

/** Log what a request cost (to Vercel's logs, and the Blob store when there is one). Never throws. */
export async function logCost(meter: Meter, kind: CostKind): Promise<void> {
  if (!meter.claude.calls && !meter.depop.runs) return; // nothing was spent
  console.log("cost", JSON.stringify({ kind, ok: meter.ok, usd: round(meter.usd), claude: meter.claude, depop: meter.depop, ms: Date.now() - meter.startedAt }));
  if (!storageConfigured()) return;
  try {
    await recordCost(store(), meter, kind);
  } catch (e) {
    console.error("couldn't record the cost", e);
  }
}

const emptyTotals = (): CostTotals => ({ usd: 0, requests: 0, byKind: {} });

function add(totals: CostTotals, kinds: Partial<Record<CostKind, KindDay>>) {
  for (const [kind, k] of Object.entries(kinds) as [CostKind, KindDay][]) {
    const t = (totals.byKind[kind] ??= { n: 0, claudeUsd: 0, depopUsd: 0 });
    t.n += k.n;
    t.claudeUsd = round(t.claudeUsd + k.claudeUsd);
    t.depopUsd = round(t.depopUsd + k.depopUsd);
    totals.requests += k.n;
    totals.usd = round(totals.usd + k.claudeUsd + k.depopUsd);
  }
}

/** Spend over the last 7 and 30 days (UTC days, today included) and the latest requests. */
export async function costSummary(s: Store, now = Date.now()): Promise<Omit<CostSummary, "enabled">> {
  const paths = [...new Set([monthPath(now), monthPath(now - 31 * DAY)])];
  const files = await Promise.all(paths.map((p) => s.readJson<Month>(p)));
  const week = emptyTotals();
  const month = emptyTotals();
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  for (const file of files) {
    for (const [day, kinds] of Object.entries(file?.data.days ?? {})) {
      const daysAgo = Math.round((today - Date.parse(`${day}T00:00:00Z`)) / DAY);
      if (daysAgo < 0 || daysAgo >= 30) continue;
      add(month, kinds);
      if (daysAgo < 7) add(week, kinds);
    }
  }
  const recent = files
    .flatMap((f) => f?.data.recent ?? [])
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  return { week, month, recent };
}
