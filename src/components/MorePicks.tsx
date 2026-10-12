"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDrop, sendMessage } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { Elsewhere, PassToast, requestLabel, Thinking, usePass } from "./Bits";
import { Disclosure, ListingCard } from "./Listing";

export function MorePicks() {
  const { loaded, feed, pending, feedError, moreNote, status, prefs } = useApp();
  const router = useRouter();
  const finding = pending?.intent === "more";
  const ready = status?.claude !== false;
  const { last: passed, pass, undo } = usePass();

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1 className="display display--page">More picks</h1>
          {feed && (
            <p className="sub">
              {requestLabel(feed.request)} · {feed.picks.length} piece{feed.picks.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <Link className="text-btn" href="/">
          Back to For you
        </Link>
      </header>

      {loaded && !feed ? (
        <p className="lede">
          Your picks show up on <Link href="/">For you</Link> first. Come back here for more.
        </p>
      ) : (
        <div className="grid">
          {(feed?.picks ?? []).map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              where="more"
              onPass={finding ? undefined : () => pass(l)}
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

      {feed && (
        <div className="more-foot">
          {finding && pending ? (
            <Thinking key={pending.startedAt} {...pending} />
          ) : (
            <button type="button" className="btn" onClick={() => getDrop({ more: true })} disabled={!!pending || !ready}>
              Find more
            </button>
          )}
          {moreNote && !finding && <p className="muted">{moreNote}</p>}
          {feedError?.intent === "more" && !finding && <p className="error">{feedError.text}</p>}
          {feed.query && <Elsewhere query={feed.query} department={prefs.department} />}
          <Disclosure />
        </div>
      )}
      {passed && <PassToast onUndo={undo} />}
    </main>
  );
}
