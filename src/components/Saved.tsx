"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { ListingCard } from "./Listing";

export function Saved() {
  const { loaded, saved, pending, status } = useApp();
  const router = useRouter();
  const ready = status?.claude !== false;
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1 className="display display--page">Saved</h1>
          {saved.length > 0 && (
            <p className="sub">
              {saved.length} piece{saved.length === 1 ? "" : "s"} you kept
            </p>
          )}
        </div>
      </header>
      {loaded && saved.length === 0 ? (
        <p className="lede">
          Nothing saved yet. Tap the heart on any pick on <Link href="/">For you</Link> and it stays here.
        </p>
      ) : (
        <div className="grid">
          {saved.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              onMore={
                pending || !ready
                  ? undefined
                  : () => {
                      sendMessage({ text: `More like this: ${l.title}`, photoUrl: l.thumb });
                      router.push("/");
                    }
              }
            />
          ))}
        </div>
      )}
      {saved.length > 0 && <p className="hint">Secondhand pieces sell quickly, so a link can stop working once its piece is sold.</p>}
    </main>
  );
}
