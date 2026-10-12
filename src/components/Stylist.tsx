"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { retryLast, sendMessage } from "@/lib/client/api";
import { processChatPhoto } from "@/lib/client/images";
import { useApp, type StylistTurn } from "@/lib/client/store";
import type { Department, Pick } from "@/lib/types";
import { ArrowRight, ArrowUp, Close, ImagePlus } from "./icons";
import { PickCard } from "./PickCard";

const STARTERS = [
  "Find me a jacket for fall",
  "Something like my board, under $150",
  "What’s missing from my wardrobe?",
  "Shoes that go with my board",
];

const ELSEWHERE: { name: string; url: (q: string, d: Department) => string }[] = [
  { name: "Grailed", url: (q) => `https://www.grailed.com/shop?query=${encodeURIComponent(q)}` },
  { name: "Depop", url: (q) => `https://www.depop.com/search/?q=${encodeURIComponent(q)}` },
  {
    name: "Poshmark",
    url: (q, d) => `https://poshmark.com/search?query=${encodeURIComponent(q)}${d === "men" ? "&department=Men" : d === "women" ? "&department=Women" : ""}`,
  },
  { name: "Vinted", url: (q) => `https://www.vinted.com/catalog?search_text=${encodeURIComponent(q)}` },
  { name: "eBay", url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
];

function Elsewhere({ query, department }: { query: string; department: Department }) {
  return (
    <p className="elsewhere">
      Not quite? The same search on{" "}
      {ELSEWHERE.map((site, i) => (
        <span key={site.name}>
          <a href={site.url(query, department)} target="_blank" rel="noopener noreferrer">
            {site.name}
          </a>
          {i < ELSEWHERE.length - 2 ? ", " : i === ELSEWHERE.length - 2 ? " or " : ""}
        </span>
      ))}
      .
    </p>
  );
}

function Reply({
  turn,
  last,
  department,
  onAsk,
  onMore,
}: {
  turn: StylistTurn;
  last: boolean;
  department: Department;
  onAsk: (text: string) => void;
  onMore: (pick: Pick) => void;
}) {
  return (
    <div className="turn turn--stylist" data-turn={turn.id}>
      <p className={turn.error ? "say say--error" : "say"}>{turn.text}</p>
      {turn.error && last && (
        <button type="button" className="text-btn" onClick={retryLast}>
          Try again
        </button>
      )}
      {turn.picks.length > 0 && (
        <div className="picks">
          {turn.picks.map((p) => (
            <PickCard key={p.id} pick={p} onMore={() => onMore(p)} />
          ))}
        </div>
      )}
      {turn.query && <Elsewhere query={turn.query} department={department} />}
      {last && turn.followUps.length > 0 && (
        <div className="followups">
          {turn.followUps.map((f) => (
            <button type="button" key={f} onClick={() => onAsk(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Thinking({ status, notices, startedAt }: { status: string; notices: string[]; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="turn turn--stylist">
      <p className="thinking" aria-live="polite">
        <span>{status}</span>
        <span className="elapsed">{seconds}s</span>
      </p>
      {notices.map((n) => (
        <p key={n} className="notice-line">
          {n}
        </p>
      ))}
    </div>
  );
}

export function Stylist() {
  const { loaded, chat, board, pending, status, prefs } = useApp();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ data: string; preview: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ready = status?.claude !== false;
  const lastTurn = chat.at(-1);

  // When you send, show the bottom (your message and the progress line). When the
  // stylist answers, show the top of the answer so the message is read first.
  const lastId = lastTurn?.id;
  const lastRole = lastTurn?.role;
  useEffect(() => {
    if (!lastId) return;
    if (lastRole === "stylist") {
      document.querySelector(`[data-turn="${lastId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    }
  }, [lastId, lastRole]);

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

  const empty = loaded && chat.length === 0 && !pending;
  const shops = `${status?.shops ?? 20} independent vintage shops`;
  const where = status?.ebay === false ? shops : `eBay and ${shops}`;
  const needsSizes = !prefs.tops.length && !prefs.waist.length && !prefs.shoes.length && prefs.maxPrice == null;

  return (
    <main className="stylist">
      <div className="thread">
        {status && !status.claude && (
          <div className="setup">
            <p className="eyebrow">One step left</p>
            <p>
              Connect Claude to wake your stylist. In Vercel, open this project, go to <b>Settings → Environment Variables</b>,
              add <code>ANTHROPIC_API_KEY</code> with your key from console.anthropic.com, then redeploy.
            </p>
          </div>
        )}

        {empty && (
          <section className="hero">
            <p className="eyebrow">Your personal AI stylist</p>
            <h1 className="display">Tell me what you’re looking for.</h1>
            <p className="lede">
              {board.length
                ? `I’ve seen the ${board.length} photo${board.length === 1 ? "" : "s"} on your moodboard. Ask for anything and I’ll search ${where}, then show you only what’s worth your time.`
                : `Pin photos of clothes you love to your moodboard, then ask me for anything. I’ll search ${where}, and show you only what’s worth your time.`}
            </p>
            {!board.length && (
              <Link className="btn" href="/board">
                Start your moodboard
              </Link>
            )}
            <ul className="starters">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => ask(s)} disabled={!ready}>
                    <span>{s}</span>
                    <ArrowRight size={18} />
                  </button>
                </li>
              ))}
            </ul>
            {needsSizes && (
              <p className="hint">
                Tip: add your <Link href="/settings">sizes and budget</Link> so I only show things that fit.
              </p>
            )}
          </section>
        )}

        {chat.map((turn, i) =>
          turn.role === "user" ? (
            <div className="turn turn--user" key={turn.id} data-turn={turn.id}>
              <div className="bubble">
                {turn.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={turn.photo} alt="Attached photo" referrerPolicy="no-referrer" />
                )}
                <p>{turn.text}</p>
              </div>
            </div>
          ) : (
            <Reply
              key={turn.id}
              turn={turn}
              last={i === chat.length - 1 && !pending}
              department={prefs.department}
              onAsk={(t) => ask(t)}
              onMore={(p) => ask(`More like this: ${p.title}`, { photoUrl: p.thumb })}
            />
          ),
        )}

        {pending && <Thinking key={pending.startedAt} {...pending} />}
        {!pending && lastTurn?.role === "user" && (
          <div className="turn turn--stylist">
            <p className="notice-line">No answer came back for this one.</p>
            <button type="button" className="text-btn" onClick={retryLast}>
              Ask again
            </button>
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <div className="composer-inner">
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
            <button
              type="button"
              className="icon-btn"
              aria-label="Add a photo"
              title="Add a photo"
              onClick={() => fileRef.current?.click()}
              disabled={!ready}
            >
              <ImagePlus />
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
              placeholder={lastTurn?.role === "stylist" && !lastTurn.error ? "Ask a follow-up" : "Ask your stylist"}
              aria-label="Message"
              enterKeyHint="send"
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
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
        </div>
      </form>
    </main>
  );
}
