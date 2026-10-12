"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { place, tidy } from "@/lib/board-layout";
import { importLink, readBoard } from "@/lib/client/api";
import { processPhoto } from "@/lib/client/images";
import { newId, setState, useApp, type BoardItem } from "@/lib/client/store";
import { PinBoard } from "./PinBoard";
import { StyleRead } from "./StyleRead";

const PHONE = "(max-width: 640px)";

function useIsPhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(PHONE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

export function Moodboard() {
  const { loaded, board, profile, reading, readError, status } = useApp();
  const phone = useIsPhone();
  const [adding, setAdding] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Photo width in board units (the board is 1000 wide): two across on a phone, three on a computer.
  const width = phone ? 470 : 310;

  const addBlobs = useCallback(
    async (blobs: Blob[]) => {
      const usable = blobs.filter((b) => b.type.startsWith("image/") || b.type.startsWith("video/"));
      if (usable.length < blobs.length) setErrors((e) => [...e, "Only photos and videos can go on the board."]);
      setAdding((n) => n + usable.length);
      for (const blob of usable) {
        try {
          const photo = await processPhoto(blob);
          setState((s) => {
            const spot = place(s.board, width);
            const z = s.board.reduce((m, i) => Math.max(m, i.z), 0) + 1;
            const item: BoardItem = { id: newId(), ...photo, ...spot, w: width, z, addedAt: Date.now() };
            return { board: [...s.board, item] };
          });
        } catch (e) {
          setErrors((list) => [...list, (e as Error).message]);
        } finally {
          setAdding((n) => n - 1);
        }
      }
    },
    [width],
  );

  const addLink = useCallback(
    async (url: string) => {
      setAdding((n) => n + 1);
      try {
        const blob = await importLink(url.trim());
        setAdding((n) => n - 1);
        await addBlobs([blob]);
      } catch (e) {
        setAdding((n) => n - 1);
        setErrors((list) => [...list, (e as Error).message]);
      }
    },
    [addBlobs],
  );

  // Paste a photo or a link anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        addBlobs(files);
        return;
      }
      const text = e.clipboardData?.getData("text") ?? "";
      if (isUrl(text)) {
        e.preventDefault();
        addLink(text);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addBlobs, addLink]);

  // The first time the board has a few photos, have the stylist read it.
  const enough = board.length >= 3;
  useEffect(() => {
    if (!loaded || !enough || profile || reading || readError || status?.claude === false) return;
    const t = setTimeout(() => readBoard(), 2500);
    return () => clearTimeout(t);
  }, [loaded, enough, profile, reading, readError, status?.claude, board.length]);

  const update = useCallback((id: string, patch: Partial<BoardItem>) => {
    setState((s) => ({ board: s.board.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  }, []);
  const remove = useCallback((id: string) => {
    setState((s) => ({ board: s.board.filter((b) => b.id !== id) }));
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (files.length) return addBlobs(files);
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (isUrl(url.split("\n")[0])) addLink(url.split("\n")[0]);
  }

  return (
    <main
      className={dropping ? "page board-page is-dropping" : "page board-page"}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <header className="page-head">
        <div>
          <p className="eyebrow">
            Moodboard{loaded && board.length > 0 ? ` · ${board.length} photo${board.length === 1 ? "" : "s"}` : ""}
          </p>
          <h1 className="display display--page">Your moodboard</h1>
        </div>
        <div className="toolbar">
          <button type="button" className="text-btn" onClick={() => fileRef.current?.click()}>
            Add photos
          </button>
          <button type="button" className="text-btn" aria-expanded={linkOpen} onClick={() => setLinkOpen((v) => !v)}>
            Add from a link
          </button>
          {board.length > 1 && (
            <button type="button" className="text-btn" onClick={() => setState((s) => ({ board: tidy(s.board, width) }))}>
              Tidy up
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            addBlobs([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </header>

      {linkOpen && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!link.trim()) return;
            addLink(link);
            setLink("");
          }}
        >
          <input
            type="url"
            inputMode="url"
            placeholder="Paste a Pinterest pin, a shop page or a photo link"
            aria-label="Link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            autoFocus
          />
          <button className="btn btn--ghost" disabled={!link.trim()}>
            Add
          </button>
        </form>
      )}

      {(adding > 0 || errors.length > 0) && (
        <div className="board-status" aria-live="polite">
          {adding > 0 && (
            <p className="thinking">
              <span>
                Adding {adding} photo{adding === 1 ? "" : "s"}
              </span>
            </p>
          )}
          {errors.map((e, i) => (
            <p key={i} className="error">
              {e}
            </p>
          ))}
          {errors.length > 0 && (
            <button type="button" className="text-btn" onClick={() => setErrors([])}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="board-layout">
        <div className="board-col">
          {loaded && board.length === 0 && adding === 0 ? (
            <button type="button" className="board-empty" onClick={() => fileRef.current?.click()}>
              <span className="board-empty-title">Start with what you love.</span>
              <span>
                Add photos and screenshots of clothes, outfits and people whose style you like. Videos work too: shopr keeps a still from
                each. You can also paste a Pinterest link.
              </span>
              <span className="btn">Add photos</span>
            </button>
          ) : (
            <PinBoard items={board} onChange={update} onRemove={remove} />
          )}
          {board.length > 0 && (
            <p className="hint">
              {phone
                ? "Tap a photo to move it, resize it from the corner, or take it off."
                : "Drag photos to arrange them. Click one to resize it from the corner or take it off. You can also paste or drop photos and links anywhere here."}
            </p>
          )}
        </div>
        <aside className="board-aside">
          <StyleRead />
        </aside>
      </div>
    </main>
  );
}

