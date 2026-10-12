"use client";

import Link from "next/link";
import { toggleSaved, useApp } from "@/lib/client/store";
import { PickCard } from "./PickCard";

export function Saved() {
  const { loaded, saved } = useApp();
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Saved{saved.length ? ` · ${saved.length}` : ""}</p>
          <h1 className="display display--page">Pieces you kept</h1>
        </div>
      </header>
      {loaded && saved.length === 0 ? (
        <p className="lede">
          Nothing saved yet. When your <Link href="/">stylist</Link> shows you something you like, tap Save and it stays here.
        </p>
      ) : (
        <div className="grid">
          {saved.map((p) => (
            <PickCard key={p.id} pick={p} onRemove={() => toggleSaved(p)} />
          ))}
        </div>
      )}
      {saved.length > 0 && <p className="hint">Secondhand pieces sell quickly. A link may stop working once its piece is sold.</p>}
    </main>
  );
}
