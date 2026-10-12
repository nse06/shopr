"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { seeded } from "@/lib/board-layout";
import { findBoards } from "@/lib/client/sharing";
import { useApp } from "@/lib/client/store";
import type { BoardSummary } from "@/lib/types";
import { Search } from "./icons";

/** A board's first few photos as little polaroids on a scrap of cork. */
function Cover({ board }: { board: BoardSummary }) {
  const rand = seeded(board.handle);
  return (
    <div className="cover cork" aria-hidden>
      {board.cover.slice(0, 4).map((src, i) => (
        <span key={src} className="cover-photo" style={{ "--rot": `${(rand() * 10 - 5).toFixed(1)}deg`, "--i": i } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" />
        </span>
      ))}
    </div>
  );
}

export function BoardCard({ board }: { board: BoardSummary }) {
  return (
    <Link href={`/u/${board.handle}`} className="board-card">
      <Cover board={board} />
      <span className="board-card-name">{board.name}</span>
      <span className="board-card-meta">
        @{board.handle} · {board.count} photo{board.count === 1 ? "" : "s"}
      </span>
      {(board.bio || board.headline) && <span className="board-card-line">{board.bio || board.headline}</span>}
    </Link>
  );
}

export function Explore() {
  const { status, publish } = useApp();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ q: string; boards: BoardSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        findBoards(q.trim(), controller.signal)
          .then((boards) => {
            setResult({ q: q.trim(), boards });
            setError(null);
          })
          .catch((e: Error) => {
            if (e.name !== "AbortError") setError(e.message);
          });
      },
      q ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const notSetUp = status?.sharing === false;
  const mine = publish?.handle && publish.publishedAt ? publish.handle : null;

  return (
    <main className="page explore">
      <header className="page-head">
        <div>
          <p className="eyebrow">Explore</p>
          <h1 className="display display--page">Other people&apos;s boards</h1>
          <p className="lede">Look through other people&apos;s moodboards. Pin a photo you love onto yours, or copy a whole board.</p>
        </div>
      </header>

      {notSetUp ? (
        <p className="empty">
          Sharing isn&apos;t set up on this shopr yet. In Vercel, open your project, then Storage, create a Blob store and connect it to the
          project. Redeploy, and boards will show up here.
        </p>
      ) : (
        <>
          <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
            <Search size={18} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search names and styles: 70s, workwear, @handle"
              aria-label="Search boards"
              autoCapitalize="none"
              enterKeyHint="search"
            />
          </form>

          {error && <p className="error">{error}</p>}
          {!result && !error && (
            <p className="thinking">
              <span>Looking for boards</span>
            </p>
          )}

          {result && result.boards.length > 0 && (
            <div className="board-grid">
              {result.boards.map((b) => (
                <BoardCard key={b.handle} board={b} />
              ))}
            </div>
          )}

          {result && result.boards.length === 0 && (
            <p className="empty">
              {result.q ? (
                <>No boards match “{result.q}” yet. Try a broader word, like a colour or an era.</>
              ) : (
                <>
                  No one has shared a board yet. <Link href="/board">Share yours</Link> and it will be the first.
                </>
              )}
            </p>
          )}

          {!mine && result && result.boards.length > 0 && (
            <p className="hint">
              Want your board here too? <Link href="/board">Share it from your board page.</Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
