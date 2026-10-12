"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { refreshStatus } from "@/lib/client/api";
import { flush, loadStore, savePassword, useApp } from "@/lib/client/store";
import { Heart, Sliders } from "./icons";

const NAV = [
  { href: "/", label: "For you", also: ["/more"] },
  { href: "/board", label: "Board", also: [] },
  { href: "/explore", label: "Explore", also: ["/u/"] },
];

/** Pages anyone can see, even when this shopr is locked: other people's shared boards. */
const isPublicPage = (path: string) => path === "/explore" || path.startsWith("/u/");

function Masthead() {
  const path = usePathname();
  const { saved } = useApp();
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href="/" className="wordmark" aria-label="shopr, your personal AI stylist">
          shopr
        </Link>
        <span className="tagline">your personal AI stylist</span>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href || n.also.some((a) => path.startsWith(a)) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
          <Link
            href="/saved"
            aria-current={path === "/saved" ? "page" : undefined}
            aria-label={saved.length ? `Saved (${saved.length})` : "Saved"}
            className="nav-icon"
          >
            <Heart size={21} filled={path === "/saved"} />
            {saved.length > 0 && <span className="count">{saved.length}</span>}
          </Link>
          <Link href="/settings" aria-current={path === "/settings" ? "page" : undefined} aria-label="Settings" className="nav-icon">
            <Sliders size={20} />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function PasswordGate() {
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    savePassword(value);
    const status = await refreshStatus();
    setBusy(false);
    if (!status?.authorized) {
      savePassword(null);
      setWrong(true);
    }
  }

  return (
    <main className="page gate">
      <h1 className="display">This shopr is locked.</h1>
      <p className="lede">Enter the password you set in Vercel (APP_PASSWORD). This device will remember it.</p>
      <form onSubmit={unlock} className="gate-form">
        <input
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setWrong(false);
          }}
          autoFocus
        />
        <button className="btn" disabled={!value || busy}>
          {busy ? "Checking" : "Unlock"}
        </button>
      </form>
      {wrong && <p className="error">That&apos;s not it. Try again.</p>}
    </main>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { locked } = useApp();
  const path = usePathname();

  useEffect(() => {
    loadStore();
    refreshStatus();
    const save = () => flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      <Masthead />
      {locked && !isPublicPage(path) ? <PasswordGate /> : children}
    </>
  );
}
