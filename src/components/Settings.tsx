"use client";

import { useState } from "react";
import { refreshStatus } from "@/lib/client/api";
import { savePassword, setPrefs, setState, useApp } from "@/lib/client/store";
import type { Department } from "@/lib/types";

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

export function Settings() {
  const { prefs, status, chat, board, saved } = useApp();
  // Typed text for the budget, so a half-typed number isn't rewritten under your fingers.
  const [min, setMin] = useState<string | null>(null);
  const [max, setMax] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  function clear(what: "chat" | "board" | "saved") {
    if (confirm !== what) return setConfirm(what);
    setConfirm(null);
    if (what === "chat") setState({ chat: [] });
    if (what === "board") setState({ board: [], profile: null, readError: null });
    if (what === "saved") setState({ saved: [] });
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
          <Check ok>
            <b>{status?.shops ?? 20} independent vintage and archive shops</b> are always searched.
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
          <h2 className="section-title">Your data</h2>
          <p className="muted">Everything stays in this browser on this device. Each message to your stylist costs a few cents of Claude usage.</p>
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
        </div>
      </section>
    </main>
  );
}
