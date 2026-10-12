"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { retryLast, sendMessage } from "@/lib/client/api";
import { processChatPhoto } from "@/lib/client/images";
import { useApp } from "@/lib/client/store";
import { ago, PassToast, requestLabel, Thinking, usePass } from "./Bits";
import { ArrowRight, ArrowUp, Camera, Close, Refresh, Sparkle } from "./icons";
import { Disclosure, ListingTile } from "./Listing";

const STARTERS = ["Only jackets", "Under $100", "Something for a wedding"];
const SHOWN_TURNS = 6;

// Picking from the board starts by itself once per visit, never in a loop.
let autoPicked = false;

export function Home() {
  const { loaded, board, feed, chat, pending, status, feedError: failed } = useApp();
  const feedError = failed?.intent === "feed" ? failed.text : null;
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ data: string; preview: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { last: passed, pass, undo } = usePass();
  const topRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ready = status?.claude !== false;
  const updating = pending != null && pending.intent !== "more";
  const enoughBoard = board.length >= 3;

  // The first time there's a board but no picks yet, pick from it.
  useEffect(() => {
    if (autoPicked || !loaded || feed || pending || !status?.claude || !enoughBoard) return;
    autoPicked = true;
    sendMessage({ intent: "feed" });
  }, [loaded, feed, pending, status?.claude, enoughBoard]);

  // When new picks arrive, bring them into view.
  const feedAt = feed?.at;
  useEffect(() => {
    if (feedAt && Date.now() - feedAt < 5000) topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [feedAt]);

  // When you send something, keep the progress line in view.
  const pendingAt = updating ? pending?.startedAt : undefined;
  useEffect(() => {
    if (pendingAt) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [pendingAt]);

  function ask(message: string, extra?: { photoUrl?: string }) {
    if (pending || !ready) return;
    if (!message.trim() && !photo && !extra?.photoUrl) return;
    sendMessage({ text: message, photo, photoUrl: extra?.photoUrl });
    setText("");
    setPhoto(null);
    if (inputRef.current) inputRef.current.style.height = "";
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      setPhoto(await processChatPhoto(file));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  const picks = feed?.picks.slice(0, 9) ?? [];
  const subtitle = feed ? `${requestLabel(feed.request)} · ${ago(feed.at)}` : null;
  const turns = showAll ? chat : chat.slice(-SHOWN_TURNS);
  const last = chat.at(-1);
  const chips = last?.role === "stylist" && !last.error && last.followUps.length ? last.followUps : chat.length ? [] : STARTERS;

  return (
    <main className="home">
      <section className="picks-head" ref={topRef}>
        <div className="title-row">
          <h1 className="display">
            Picked for you <Sparkle color="var(--accent)" />
          </h1>
          {feed && (
            <button
              type="button"
              className="icon-btn"
              aria-label="New picks from your board"
              title="New picks from your board"
              onClick={() => sendMessage({ intent: "feed" })}
              disabled={!!pending || !ready}
            >
              <Refresh />
            </button>
          )}
        </div>
        {subtitle && <p className="sub">{subtitle}</p>}
        {feed && feedError && !pending && <p className="error">{feedError}</p>}
      </section>

      {status && !status.claude && (
        <div className="setup">
          <p>
            <b>One step left:</b> connect Claude to wake your stylist. In Vercel, open this project, go to <b>Settings → Environment Variables</b>,
            add <code>ANTHROPIC_API_KEY</code> with your key from console.anthropic.com, then redeploy.
          </p>
        </div>
      )}

      {feed ? (
        <>
          <div className={updating ? "grid9 is-updating" : "grid9"} aria-busy={updating}>
            {picks.map((l) => (
              <ListingTile key={l.id} listing={l} onPass={updating ? undefined : () => pass(l)} />
            ))}
          </div>
          {picks.length === 0 && <p className="muted">Nothing fit this time. Ask for something else below.</p>}
          <Link className="btn btn--block" href="/more">
            More picks <ArrowRight size={18} />
          </Link>
          <Disclosure />
          {passed && <PassToast onUndo={undo} />}
        </>
      ) : !loaded ? null : updating ? (
        <div className="grid9" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="tile tile--ghost" />
          ))}
        </div>
      ) : feedError ? (
        <div className="empty">
          <p className="error">{feedError}</p>
          <button type="button" className="btn" onClick={() => sendMessage({ intent: "feed" })} disabled={!ready}>
            Try again
          </button>
        </div>
      ) : enoughBoard ? (
        <div className="empty">
          <p>Your board is ready. I’ll pick nine pieces from it.</p>
          <button type="button" className="btn" onClick={() => sendMessage({ intent: "feed" })} disabled={!ready}>
            Pick for me
          </button>
        </div>
      ) : (
        <div className="empty">
          <p>
            {board.length
              ? "Add a couple more photos to your board (three or more) and I’ll start picking."
              : "Pin a few photos of clothes you love, and I’ll pick pieces from eBay and independent vintage shops that match."}
          </p>
          <Link className="btn" href="/board">
            {board.length ? "Back to your board" : "Start your moodboard"}
          </Link>
        </div>
      )}

      <section className="chat" aria-label="Chat with your stylist">
        {chat.length === 0 && !updating && (
          <div className="turn turn--stylist">
            <span className="avatar" aria-hidden="true">
              s
            </span>
            <p>Tell me what you’re after and I’ll swap the picks.</p>
          </div>
        )}
        {chat.length > turns.length && (
          <button type="button" className="text-btn earlier" onClick={() => setShowAll(true)}>
            Show earlier messages
          </button>
        )}
        {turns.map((turn) =>
          turn.role === "user" ? (
            <div className="turn turn--user" key={turn.id}>
              <div className="bubble">
                {turn.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={turn.photo} alt="Attached photo" referrerPolicy="no-referrer" />
                )}
                <p>{turn.text}</p>
              </div>
            </div>
          ) : (
            <div className="turn turn--stylist" key={turn.id}>
              <span className="avatar" aria-hidden="true">
                s
              </span>
              <div>
                <p className={turn.error ? "error" : undefined}>{turn.text}</p>
                {turn.error && turn.id === last?.id && !pending && (
                  <button type="button" className="text-btn" onClick={retryLast}>
                    Try again
                  </button>
                )}
              </div>
            </div>
          ),
        )}
        {updating && pending && (
          <div className="turn turn--stylist">
            <span className="avatar" aria-hidden="true">
              s
            </span>
            <Thinking key={pending.startedAt} {...pending} />
          </div>
        )}
        {!pending && last?.role === "user" && (
          <div className="turn turn--stylist">
            <span className="avatar" aria-hidden="true">
              s
            </span>
            <div>
              <p className="muted">No answer came back for this one.</p>
              <button type="button" className="text-btn" onClick={retryLast}>
                Ask again
              </button>
            </div>
          </div>
        )}
        {chips.length > 0 && !pending && (
          <div className="chips">
            {chips.map((c) => (
              <button type="button" key={c} onClick={() => ask(c)} disabled={!ready}>
                {c}
              </button>
            ))}
          </div>
        )}
      </section>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        {(photo || photoError) && (
          <div className="attached">
            {photo && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt="Photo to send" />
                <button type="button" className="icon-btn icon-btn--small" aria-label="Remove photo" onClick={() => setPhoto(null)}>
                  <Close size={16} />
                </button>
              </>
            )}
            {photoError && <span className="error">{photoError}</span>}
          </div>
        )}
        <div className="composer-row">
          <button type="button" className="icon-btn" aria-label="Add a photo" title="Add a photo" onClick={() => fileRef.current?.click()} disabled={!ready}>
            <Camera />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              attach(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder="Ask your stylist"
            aria-label="Message"
            enterKeyHint="send"
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(text);
              }
            }}
            disabled={!ready}
          />
          <button className="icon-btn send" aria-label="Send" disabled={!!pending || !ready || (!text.trim() && !photo)}>
            <ArrowUp />
          </button>
        </div>
      </form>
    </main>
  );
}
