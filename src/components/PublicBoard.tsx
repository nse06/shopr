"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readingOrder } from "@/lib/board-layout";
import { Locked } from "@/lib/client/api";
import { useBoardColumns } from "@/lib/client/hooks";
import { copyBoard, copyPhoto } from "@/lib/client/sharing";
import { useApp } from "@/lib/client/store";
import type { PublicBoard, PublicPhoto } from "@/lib/types";
import { ago } from "./Bits";
import { ChevronLeft, ChevronRight, Close } from "./icons";
import { PinBoard } from "./PinBoard";
import { ProfileBody } from "./StyleRead";

function prettyLink(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/** One photo, big, with a button to pin it onto your board. Arrows (or a swipe) go to the next. */
function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  onAdd,
  isMarked,
  adding,
  canAdd,
}: {
  photos: PublicPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onAdd: (photo: PublicPhoto) => void;
  isMarked: (photo: PublicPhoto) => boolean;
  adding: Set<string>;
  canAdd: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const photo = photos[index];
  const go = (step: number) => onIndex((index + step + photos.length) % photos.length);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Arrow keys, wherever the focus is (a button that just got disabled loses it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (photos.length < 2 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      e.preventDefault();
      onIndex((index + (e.key === "ArrowRight" ? 1 : -1) + photos.length) % photos.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex]);

  const marked = isMarked(photo);
  const busy = adding.has(photo.id);

  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s || photos.length < 2) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
      }}
    >
      <figure className="lightbox-figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="" />
        <figcaption>
          {canAdd ? (
            <button type="button" className="btn" disabled={marked || busy} onClick={() => onAdd(photo)}>
              {marked ? "On your board" : busy ? "Adding" : "Add to my board"}
            </button>
          ) : (
            <Link href="/" className="btn">
              Unlock shopr to add photos
            </Link>
          )}
          {photos.length > 1 && (
            <span className="lightbox-count">
              {index + 1} of {photos.length}
            </span>
          )}
        </figcaption>
      </figure>
      <button type="button" className="lightbox-btn lightbox-close" aria-label="Close" onClick={() => ref.current?.close()}>
        <Close size={20} />
      </button>
      {photos.length > 1 && (
        <>
          <button type="button" className="lightbox-btn lightbox-prev" aria-label="Previous photo" onClick={() => go(-1)}>
            <ChevronLeft size={22} />
          </button>
          <button type="button" className="lightbox-btn lightbox-next" aria-label="Next photo" onClick={() => go(1)}>
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </dialog>
  );
}

export function PublicBoardView({ board }: { board: PublicBoard }) {
  const { board: mine, locked, publish } = useApp();
  const columns = useBoardColumns();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  const photos = readingOrder(board.photos);
  const marked = new Set(mine.filter((b) => b.from?.handle === board.handle).map((b) => b.from!.photo));
  const rest = board.photos.filter((p) => !marked.has(p.id));
  const isMine = publish?.handle === board.handle && Boolean(publish.publishedAt);

  async function add(photo: PublicPhoto) {
    setAdding((s) => new Set(s).add(photo.id));
    try {
      await copyPhoto(board, photo, columns);
    } catch (e) {
      if (!(e instanceof Locked)) setNote({ text: (e as Error).message || "Couldn't add that photo. Try again.", error: true });
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(photo.id);
        return next;
      });
    }
  }

  async function copyAll() {
    if (copying || !rest.length) return;
    setNote(null);
    setCopying(`Copying photos (0 of ${rest.length})`);
    try {
      const { copied, failed } = await copyBoard({ ...board, photos: rest }, columns, (done, total) => setCopying(`Copying photos (${done} of ${total})`));
      setNote(
        copied
          ? { text: `Copied ${copied} photo${copied === 1 ? "" : "s"} onto your board.${failed ? ` ${failed} couldn't be copied.` : ""}` }
          : { text: "Couldn't copy the photos. Try again.", error: true },
      );
    } catch (e) {
      if (!(e instanceof Locked)) setNote({ text: "Couldn't copy the photos. Try again.", error: true });
    } finally {
      setCopying(null);
    }
  }

  return (
    <main className="page board-page public-board">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            Moodboard · {board.photos.length} photo{board.photos.length === 1 ? "" : "s"} ·{" "}
            <time dateTime={new Date(board.updatedAt).toISOString()} suppressHydrationWarning>
              updated {ago(board.updatedAt)}
            </time>
          </p>
          <h1 className="display display--page">{board.name}</h1>
          <p className="profile-meta">
            @{board.handle}
            {board.link && (
              <>
                {" · "}
                <a href={board.link} target="_blank" rel="nofollow ugc noopener noreferrer">
                  {prettyLink(board.link)}
                </a>
              </>
            )}
          </p>
          {board.bio && <p className="lede">{board.bio}</p>}
        </div>
        <div className="toolbar">
          {isMine ? (
            <Link href="/board" className="btn btn--ghost">
              This is your board. Edit it
            </Link>
          ) : locked ? (
            <Link href="/" className="btn btn--ghost">
              Unlock shopr to copy
            </Link>
          ) : (
            <button type="button" className="btn" onClick={copyAll} disabled={Boolean(copying) || !rest.length}>
              {!rest.length ? "All on your board" : marked.size ? `Copy the other ${rest.length}` : "Copy the whole board"}
            </button>
          )}
        </div>
      </header>

      {(copying || note) && (
        <div className="board-status" aria-live="polite">
          {copying && (
            <p className="thinking">
              <span>{copying}</span>
            </p>
          )}
          {note && (
            <p className={note.error ? "error" : "muted"}>
              {note.text}{" "}
              {!note.error && (
                <Link href="/board" className="text-btn">
                  See your board
                </Link>
              )}
            </p>
          )}
        </div>
      )}

      <div className="board-layout">
        <div className="board-col">
          <PinBoard
            items={board.photos.map((p) => ({ ...p, image: p.url }))}
            onOpen={(id) => setOpen(photos.findIndex((p) => p.id === id))}
            marked={marked}
            label={`Photo from @${board.handle}'s board`}
          />
          <p className="hint">Tap a photo to look closer and pin it onto your board.</p>
        </div>
        {board.profile && (
          <aside className="board-aside">
            <section className="read">
              <p className="eyebrow">Their style, as shopr reads it</p>
              <ProfileBody
                profile={board.profile}
                photo={(n) => {
                  const p = board.photos[n - 1];
                  return p && { id: p.id, src: p.url };
                }}
              />
            </section>
          </aside>
        )}
      </div>

      {open !== null && open >= 0 && (
        <Lightbox
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onAdd={add}
          isMarked={(p) => marked.has(p.id)}
          adding={adding}
          canAdd={!locked}
        />
      )}
    </main>
  );
}
