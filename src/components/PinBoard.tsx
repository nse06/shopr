"use client";

import { useEffect, useRef, useState } from "react";
import { BOARD_W, boardHeight, clamp } from "@/lib/board-layout";
import type { BoardItem } from "@/lib/client/store";
import { Close } from "./icons";

type Box = { x: number; y: number; w: number };
type Drag = { id: string; mode: "move" | "resize"; pointerId: number; startX: number; startY: number; orig: Box; last: Box | null };

/**
 * A free-form board: photos sit where you put them. With a mouse, drag straight
 * away. On a phone, tap a photo first (so scrolling the page still works), then
 * drag it or its corner.
 */
export function PinBoard({
  items,
  onChange,
  onRemove,
}: {
  items: BoardItem[];
  onChange: (id: string, patch: Partial<BoardItem>) => void;
  onRemove: (id: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const tap = useRef<{ id: string; x: number; y: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<(Box & { id: string }) | null>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (typing) return;
      if (e.key === "Escape") setSelected(null);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onRemove(selected);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onRemove]);

  const scale = width / BOARD_W;
  const topZ = items.reduce((z, i) => Math.max(z, i.z), 0);
  const shown = items.map((i) => (draft?.id === i.id ? { ...i, ...draft } : i));
  const height = Math.max(320, (boardHeight(shown) + 60) * scale);

  function start(e: React.PointerEvent, item: BoardItem, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (mode === "move" && e.pointerType !== "mouse" && selected !== item.id) {
      tap.current = { id: item.id, x: e.clientX, y: e.clientY }; // a tap selects; a swipe scrolls
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: item.id, mode, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, orig: { x: item.x, y: item.y, w: item.w }, last: null };
    setSelected(item.id);
    if (item.z < topZ) onChange(item.id, { z: topZ + 1 });
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !scale) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.last && Math.hypot(dx, dy) < 4) return;
    const next = d.mode === "move" ? clamp({ ...d.orig, x: d.orig.x + dx / scale, y: d.orig.y + dy / scale }) : clamp({ ...d.orig, w: d.orig.w + dx / scale });
    d.last = next;
    setDraft({ id: d.id, ...next });
  }

  function end(e: React.PointerEvent, item: BoardItem) {
    const t = tap.current;
    if (t && t.id === item.id) {
      tap.current = null;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) setSelected(item.id);
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.last) onChange(d.id, d.last);
    setDraft(null);
  }

  function cancel() {
    tap.current = null;
    drag.current = null;
    setDraft(null);
  }

  return (
    <div
      ref={boardRef}
      className="pinboard"
      style={{ height }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setSelected(null);
      }}
    >
      {scale > 0 &&
        shown.map((item, n) => {
          const isSelected = selected === item.id;
          return (
            <div
              key={item.id}
              role="group"
              aria-label={`Moodboard photo ${n + 1}`}
              tabIndex={0}
              className={isSelected ? "pin is-selected" : "pin"}
              style={{
                left: item.x * scale,
                top: item.y * scale,
                width: item.w * scale,
                height: item.w * item.aspect * scale,
                zIndex: item.z,
              }}
              onPointerDown={(e) => start(e, item, "move")}
              onPointerMove={move}
              onPointerUp={(e) => end(e, item)}
              onPointerCancel={cancel}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(isSelected ? null : item.id);
                }
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.image} alt="" draggable={false} />
              {isSelected && (
                <>
                  <button
                    type="button"
                    className="pin-remove"
                    aria-label="Take this photo off the board"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      onRemove(item.id);
                      setSelected(null);
                    }}
                  >
                    <Close size={14} />
                  </button>
                  {/* Its move and up events bubble to the photo's handlers. */}
                  <span className="pin-resize" aria-hidden onPointerDown={(e) => start(e, item, "resize")} />
                </>
              )}
            </div>
          );
        })}
    </div>
  );
}
