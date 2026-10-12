"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { call, refreshStatus } from "@/lib/client/api";
import { savePassword, setPrefs, setState, useApp } from "@/lib/client/store";
import type { ClickSummary, CostKind, CostSummary, Department } from "@/lib/types";

const TOPS = ["XS", "S", "M", "L", "XL", "XXL"];
const WAIST = ["26", "27", "28", "29", "30", "31", "32", "33", "34", "36", "38", "40"];
const SHOES = ["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14"];
const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "men", label: "Menswear" },
  { value: "women", label: "Womenswear" },
  { value: "any", label: "Both" },
];

function Choices({ options, value, onChange, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="choices" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} className="choice" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function money(text: string): number | null {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return text.trim() && Number.isFinite(n) ? Math.round(n) : null;
}

function Check({ ok, children }: { ok: boolean | undefined; children: React.ReactNode }) {
  return (
    <li className={ok ? "check is-ok" : "check"}>
      <span className="check-mark" aria-hidden>
        {ok ? "●" : "○"}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** "27¢", "0.4¢" or "$4.12". */
function dollars(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  const cents = usd * 100;
  return cents === 0 || cents >= 10 ? `${Math.round(cents)}¢` : `${cents.toFixed(1)}¢`;
}

const KIND_LABELS: Record<CostKind, string> = {
  picks: "New picks from your board",
  chat: "A message to your stylist",
  more: "Finding more",
  read: "Reading your board",
  drop: "Today's drop",
  test: "Drop test",
};

/** JSON from one of shopr's own routes: null while loading, "error" if it failed. */
function useServerData<T>(path: string): T | "error" | null {
  const [data, setData] = useState<T | "error" | null>(null);
  useEffect(() => {
    let live = true;
    call(path, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as T) : "error"))
      .catch(() => "error" as const)
      .then((result) => live && setData(result));
    return () => {
      live = false;
    };
  }, [path]);
  return data;
}

/** What the last week and month cost in Claude and Depop, from the server's log. */
function Costs() {
  const data = useServerData<CostSummary>("/api/costs");

  if (data === null) {
    return (
      <p className="thinking">
        <span>Adding it up</span>
      </p>
    );
  }
  if (data === "error") return <p className="muted">Couldn&apos;t load the costs just now.</p>;
  if (!data.enabled) return <p className="muted">Switch on sharing (a Vercel Blob store, see the README) and shopr keeps a log of what it costs here.</p>;
  if (!data.month.requests) return <p className="muted">Nothing yet. Costs show up here after your stylist&apos;s next answer.</p>;

  const kinds = (Object.keys(KIND_LABELS) as CostKind[]).filter((k) => data.month.byKind[k]?.n);
  return (
    <div className="costs">
      <div className="cost-totals">
        <div>
          <span className="label">Last 7 days</span>
          <strong>{dollars(data.week.usd)}</strong>
          <span className="muted">
            {data.week.requests} request{data.week.requests === 1 ? "" : "s"}
          </span>
        </div>
        <div>
          <span className="label">Last 30 days</span>
          <strong>{dollars(data.month.usd)}</strong>
          <span className="muted">
            {data.month.requests} request{data.month.requests === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <ul className="cost-kinds">
        {kinds.map((k) => {
          const t = data.month.byKind[k]!;
          const parts = [`Claude ${dollars(t.claudeUsd / t.n)}`, t.depopUsd > 0 ? `Depop ${dollars(t.depopUsd / t.n)}` : null].filter(Boolean);
          return (
            <li key={k}>
              <b>{KIND_LABELS[k]}</b>: about {dollars((t.claudeUsd + t.depopUsd) / t.n)} each ({parts.join(", ")}), {t.n} time{t.n === 1 ? "" : "s"}
            </li>
          );
        })}
      </ul>
      <p className="label">Latest</p>
      <ul className="cost-recent">
        {data.recent.slice(0, 8).map((e) => (
          <li key={`${e.at}-${e.kind}`}>
            <span>{new Date(e.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
            <span>
              {KIND_LABELS[e.kind]}
              {e.ok ? "" : " (didn't finish)"}
            </span>
            <span>{dollars(e.usd)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Taps through to listings: how many, to which sellers, and through whose boards. */
function Clicks() {
  const data = useServerData<ClickSummary>("/api/clicks");
  if (data === null) {
    return (
      <p className="thinking">
        <span>Counting</span>
      </p>
    );
  }
  if (data === "error") return <p className="muted">Couldn&apos;t load the clicks just now.</p>;
  if (!data.enabled) return <p className="muted">Switch on sharing (a Vercel Blob store, see the README) and shopr counts clicks here.</p>;
  if (!data.month.clicks) return <p className="muted">No clicks yet. Every tap on a pick is counted here.</p>;

  const ranked = (counts: Record<string, number>) => Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const creators = ranked(data.month.byCreator);
  return (
    <div className="costs">
      <div className="cost-totals">
        <div>
          <span className="label">Last 7 days</span>
          <strong>{data.week.clicks}</strong>
          <span className="muted">{data.week.clicks === 1 ? "click" : "clicks"}</span>
        </div>
        <div>
          <span className="label">Last 30 days</span>
          <strong>{data.month.clicks}</strong>
          <span className="muted">{data.month.clicks === 1 ? "click" : "clicks"}</span>
        </div>
      </div>
      <ul className="cost-kinds">
        <li>
          <b>Where they went</b>: {ranked(data.month.bySource).map(([source, n]) => `${source} ${n}`).join(", ")}
        </li>
        {creators.length > 0 && (
          <li>
            <b>Through creators&apos; boards</b>: {creators.map(([handle, n]) => `@${handle} ${n}`).join(", ")}
          </li>
        )}
      </ul>
      <p className="label">Latest</p>
      <ul className="cost-recent">
        {data.recent.slice(0, 8).map((c) => (
          <li key={`${c.at}-${c.title}`}>
            <span>{new Date(c.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
            <span>
              {c.title || "A listing"} ({c.source}
              {c.via ? `, via @${c.via}` : ""})
            </span>
            <span>{c.priceUsd != null ? `$${c.priceUsd}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Settings() {
  const { prefs, status, chat, board, saved, passed } = useApp();
  // Typed text for the budget, so a half-typed number isn't rewritten under your fingers.
  const [min, setMin] = useState<string | null>(null);
  const [max, setMax] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  function clear(what: "chat" | "board" | "saved" | "passed") {
    if (confirm !== what) return setConfirm(what);
    setConfirm(null);
    if (what === "chat") setState({ chat: [] });
    if (what === "board") setState({ board: [], profile: null, readError: null });
    if (what === "saved") setState({ saved: [] });
    if (what === "passed") setState({ passed: [] });
  }

  return (
    <main className="page settings">
      <header className="page-head">
        <div>
          <h1 className="display display--page">About you</h1>
        </div>
      </header>

      <section>
        <div>
          <h2 className="section-title">Sizes and budget</h2>
          <p className="muted">Your stylist skips listings that state a size you don&apos;t wear, and anything outside your budget.</p>
        </div>
        <div className="fields">
          <div className="field">
            <span className="label">I shop</span>
            <div className="choices" role="group" aria-label="Department">
              {DEPARTMENTS.map((d) => (
                <button type="button" key={d.value} className="choice" aria-pressed={prefs.department === d.value} onClick={() => setPrefs({ department: d.value })}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Tops and jackets</span>
            <Choices label="Tops and jackets" options={TOPS} value={prefs.tops} onChange={(tops) => setPrefs({ tops })} />
          </div>
          <div className="field">
            <span className="label">Waist (inches)</span>
            <Choices label="Waist" options={WAIST} value={prefs.waist} onChange={(waist) => setPrefs({ waist })} />
          </div>
          <div className="field">
            <span className="label">Shoes (US)</span>
            <Choices label="Shoes" options={SHOES} value={prefs.shoes} onChange={(shoes) => setPrefs({ shoes })} />
          </div>
          <div className="field">
            <span className="label">Budget per piece (USD)</span>
            <div className="budget">
              <label>
                <span>From $</span>
                <input
                  inputMode="numeric"
                  placeholder="0"
                  value={min ?? (prefs.minPrice ?? "").toString()}
                  onChange={(e) => {
                    setMin(e.target.value);
                    setPrefs({ minPrice: money(e.target.value) });
                  }}
                  onBlur={() => setMin(null)}
                />
              </label>
              <label>
                <span>to $</span>
                <input
                  inputMode="numeric"
                  placeholder="no limit"
                  value={max ?? (prefs.maxPrice ?? "").toString()}
                  onChange={(e) => {
                    setMax(e.target.value);
                    setPrefs({ maxPrice: money(e.target.value) });
                  }}
                  onBlur={() => setMax(null)}
                />
              </label>
            </div>
          </div>
          <label className="field">
            <span className="label">Leave out (words, separated by commas)</span>
            <input type="text" placeholder="e.g. cropped, distressed, polyester" value={prefs.avoid} onChange={(e) => setPrefs({ avoid: e.target.value })} />
          </label>
        </div>
      </section>

      <section>
        <div>
          <h2 className="section-title">Connections</h2>
          <p className="muted">Keys live in Vercel, never in this app. Change them in your project&apos;s Settings → Environment Variables, then redeploy.</p>
        </div>
        <ul className="checks">
          <Check ok={status?.claude}>
            <b>Claude</b>{" "}
            {status?.claude ? "is connected. It reads your board and chooses your picks." : "isn't connected. Add ANTHROPIC_API_KEY."}
          </Check>
          <Check ok={status?.ebay}>
            <b>eBay</b>{" "}
            {status?.ebay
              ? "is connected, including photo search."
              : "isn't connected, so only the independent shops are searched. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (Production keys from developer.ebay.com)."}
          </Check>
          <Check ok={status?.depop}>
            <b>Depop</b>{" "}
            {status?.depop
              ? "is connected through Apify. Depop listings cost about half a cent each in Apify credit, so roughly 10 cents per reply."
              : "isn't connected. Add APIFY_TOKEN (from apify.com, Settings → API & Integrations) to search Depop too."}
          </Check>
          <Check ok>
            <b>{status?.shops ?? 20} independent vintage and archive shops</b> are always searched.
          </Check>
          <Check ok={status?.sharing}>
            <b>Sharing</b>{" "}
            {status?.sharing
              ? "is on: people can share their boards and browse Explore."
              : "is off. In Vercel, open Storage, create a Blob store and connect it to this project, so people can share boards."}
          </Check>
          <Check ok={status?.referrals}>
            <b>Referral links</b>{" "}
            {status?.referrals
              ? "are on: eBay pays a commission on sales from your picks, and a note under the picks says so."
              : "are off. Join the eBay Partner Network and add your campaign ID as EBAY_CAMPAIGN_ID to earn a commission on eBay sales."}
          </Check>
          <Check ok={status?.passwordRequired}>
            <b>Password lock</b>{" "}
            {status?.passwordRequired
              ? "is on."
              : "is off: anyone with your link can use your stylist, and your Claude credit. Add APP_PASSWORD to lock it."}
          </Check>
        </ul>
        {status?.passwordRequired && (
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              savePassword(null);
              refreshStatus();
            }}
          >
            Forget the password on this device
          </button>
        )}
      </section>

      <section>
        <div>
          <h2 className="section-title">What it costs</h2>
          <p className="muted">
            Estimated from Anthropic&apos;s and Apify&apos;s list prices for what your stylist used. Your Anthropic and Apify bills are the final word.
          </p>
          <p className="muted">
            Daily drops can run on a cheaper model. <Link href="/droptest">Run the drop test</Link> to see how each one picks.
          </p>
        </div>
        <Costs />
      </section>

      <section>
        <div>
          <h2 className="section-title">Clicks</h2>
          <p className="muted">
            Taps through to listings. Shops and referral networks want to see these, and they show which creators&apos; boards lead to visits.
          </p>
        </div>
        <Clicks />
      </section>

      <section>
        <div>
          <h2 className="section-title">Your data</h2>
          <p className="muted">Everything stays in this browser on this device, except a board you choose to share.</p>
        </div>
        <div className="danger-zone">
          <button type="button" className="text-btn" onClick={() => clear("chat")} disabled={!chat.length}>
            {confirm === "chat" ? "Tap again to clear the conversation" : "Clear the conversation"}
          </button>
          <button type="button" className="text-btn" onClick={() => clear("board")} disabled={!board.length}>
            {confirm === "board" ? "Tap again to clear the moodboard" : "Clear the moodboard"}
          </button>
          <button type="button" className="text-btn" onClick={() => clear("saved")} disabled={!saved.length}>
            {confirm === "saved" ? "Tap again to clear saved pieces" : "Clear saved pieces"}
          </button>
          <button type="button" className="text-btn" onClick={() => clear("passed")} disabled={!passed.length}>
            {confirm === "passed"
              ? "Tap again to forget them"
              : passed.length
                ? `Forget the ${count(passed.length, "piece")} you said no to`
                : "Forget the pieces you said no to"}
          </button>
        </div>
      </section>
    </main>
  );
}
