// Taps through to listings, kept in the Blob store like the cost log: one file per month
// with counts per day (by source and by creator) and the latest clicks.

import type { ClickEntry, ClickSummary, ClickTotals } from "../types";
import { privateFolder, storageConfigured, store, updateJson, type Store } from "./storage";

type DayCounts = { clicks: number; bySource: Record<string, number>; byCreator: Record<string, number> };
type Month = { days: Record<string, DayCounts>; recent: ClickEntry[] };

const DAY = 86_400_000;
const RECENT = 40;

const monthPath = (at: number) => `${privateFolder("clicks")}/${new Date(at).toISOString().slice(0, 7)}.json`;
const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

export async function recordClick(s: Store, entry: ClickEntry): Promise<void> {
  await updateJson<Month>(s, monthPath(entry.at), () => ({ days: {}, recent: [] }), (month) => {
    const day = (month.days[dayKey(entry.at)] ??= { clicks: 0, bySource: {}, byCreator: {} });
    day.clicks++;
    day.bySource[entry.source] = (day.bySource[entry.source] ?? 0) + 1;
    if (entry.via) day.byCreator[entry.via] = (day.byCreator[entry.via] ?? 0) + 1;
    month.recent = [entry, ...month.recent].slice(0, RECENT);
    return month;
  });
}

/** Log a click (to Vercel's logs, and the Blob store when there is one). Never throws. */
export async function logClick(entry: ClickEntry): Promise<void> {
  console.log("click", JSON.stringify(entry));
  if (!storageConfigured()) return;
  try {
    await recordClick(store(), entry);
  } catch (e) {
    console.error("couldn't record the click", e);
  }
}

const emptyTotals = (): ClickTotals => ({ clicks: 0, bySource: {}, byCreator: {} });

function add(totals: ClickTotals, day: DayCounts) {
  totals.clicks += day.clicks;
  for (const [k, n] of Object.entries(day.bySource)) totals.bySource[k] = (totals.bySource[k] ?? 0) + n;
  for (const [k, n] of Object.entries(day.byCreator)) totals.byCreator[k] = (totals.byCreator[k] ?? 0) + n;
}

/** Clicks over the last 7 and 30 days (UTC days, today included) and the latest ones. */
export async function clickSummary(s: Store, now = Date.now()): Promise<Omit<ClickSummary, "enabled">> {
  const paths = [...new Set([monthPath(now), monthPath(now - 31 * DAY)])];
  const files = await Promise.all(paths.map((p) => s.readJson<Month>(p)));
  const week = emptyTotals();
  const month = emptyTotals();
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  for (const file of files) {
    for (const [day, counts] of Object.entries(file?.data.days ?? {})) {
      const daysAgo = Math.round((today - Date.parse(`${day}T00:00:00Z`)) / DAY);
      if (daysAgo < 0 || daysAgo >= 30) continue;
      add(month, counts);
      if (daysAgo < 7) add(week, counts);
    }
  }
  const recent = files
    .flatMap((f) => f?.data.recent ?? [])
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  return { week, month, recent };
}
