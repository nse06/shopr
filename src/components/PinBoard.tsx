"use client";

import { useEffect, useRef, useState } from "react";
import { BOARD_W, boardHeight, clamp, frameHeight, seeded, tilt, type Placed } from "@/lib/board-layout";
import { Check, Close } from "./icons";

export type PinItem = Placed & { image: string };

type Box = { x: number; y: number; w: number };
type Drag = { id: string; mode: "move" | "resize"; pointerId: number; startX: number; startY: number; scale: number; orig: Box; last: Box | null };

const TACKS = ["#e4472b", "#e4472b", "#e4472b", "#f2b134", "#3a6fd8", "#2fa58c", "#ef7fb0"];

/** Each photo is held up by a push-pin in one of a few colours, or now and then a strip of tape. */
function holder(id: string): { tape: boolean; color: string; tapeTilt: number } {
  const rand = seeded(`${id}:pin`);
  const tape = rand() < 0.2;
  return { tape, color: TACKS[Math.floor(rand() * TACKS.length)], tapeTilt: Math.round(rand() * 16 - 8) };
}

/**
 * A cork board with polaroids on it. Positions are in board units and the CSS turns
 * them into sizes (the board is 1000 units wide, whatever the screen), so it lays out
 * before any script runs.
 *
 * Photos sit where you put them: with a mouse, drag straight away; on a phone, tap a
 * photo first (so scrolling the page still works), then drag it or its corner.
 * Without onChange it's someone else's board: tapping a photo calls onOpen, and
 * `marked` photos (already on your board) get a tick.
 */
export function PinBoard({
  items,
  onChange,
  onRemove,
  onOpen,
  marked,
  label = "Moodboard photo",
}: {
  items: PinItem[];
  onChange?: (id: string, patch: Partial<Box & { z: number }>) => void;
  onRemove?: (id: string) => void;
  onOpen?: (id: string) => void;
  marked?: Set<string>;
  label?: string;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const tap = useRef<{ id: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<(Box & { id: string }) | null>(null);
  const editable = Boolean(onChange);

  // Touching anything but the selected photo puts it down.
  useEffect(() => {
    if (!selected) return;
    const onDown = (e: PointerEvent) => {
      const pin = e.target instanceof Element ? e.target.closest("[data-pin]") : null;
      if (pin?.getAttribute("data-pin") !== selected) setSelected(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selected]);

  useEffect(() => {
    if (!selected || !onRemove) return;
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

  const topZ = items.reduce((z, i) => Math.max(z, i.z), 0);
  const shown = items.map((i) => (draft?.id === i.id ? { ...i, ...draft } : i));

  function start(e: React.PointerEvent, item: PinItem, mode: Drag["mode"]) {
    if (e.button !== 0 || !onChange) return;
    e.stopPropagation();
    if (mode === "move" && e.pointerType !== "mouse" && selected !== item.id) {
      tap.current = { id: item.id, x: e.clientX, y: e.clientY }; // a tap selects; a swipe scrolls
      return;
    }
    const width = boardRef.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: item.id,
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scale: width / BOARD_W,
      orig: { x: item.x, y: item.y, w: item.w },
      last: null,
    };
    setSelected(item.id);
    if (item.z < topZ) onChange(item.id, { z: topZ + 1 });
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    if (!d.last && Math.hypot(dx * d.scale, dy * d.scale) < 4) return;
    const next = d.mode === "move" ? clamp({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }) : clamp({ ...d.orig, w: d.orig.w + dx });
    d.last = next;
    setDraft({ id: d.id, ...next });
  }

  function end(e: React.PointerEvent, item: PinItem) {
    const t = tap.current;
    if (t && t.id === item.id) {
      tap.current = null;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) setSelected(item.id);
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.last) onChange?.(d.id, d.last);
    setDraft(null);
  }

  function cancel() {
    tap.current = null;
    drag.current = null;
    setDraft(null);
  }

  return (
    <div className="cork">
      <div
        ref={boardRef}
        className={editable ? "pinboard" : "pinboard is-readonly"}
        style={{ "--board-h": boardHeight(shown) + 50 } as React.CSSProperties}
      >
        {shown.map((item, n) => {
          const isSelected = selected === item.id;
          const lifted = draft?.id === item.id;
          const hold = holder(item.id);
          const style = {
            "--x": item.x,
            "--y": item.y,
            "--w": item.w,
            "--h": frameHeight(item.w, item.aspect),
            "--rot": `${tilt(item)}deg`,
            "--tack-color": hold.color,
            "--tape-tilt": `${hold.tapeTilt}deg`,
            zIndex: item.z,
          } as React.CSSProperties;
          const holderEl = hold.tape ? <span className="pin-tape" aria-hidden /> : <span className="pin-tack" aria-hidden />;
          // eslint-disable-next-line @next/next/no-img-element
          const photo = <img src={item.image} alt="" draggable={false} loading={n > 11 ? "lazy" : undefined} />;

          if (!editable) {
            const isMarked = marked?.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={isMarked ? "pin is-marked" : "pin"}
                style={style}
                aria-label={`${label} ${n + 1}${isMarked ? ", already on your board" : ""}`}
                onClick={() => onOpen?.(item.id)}
              >
                {photo}
                {holderEl}
                {isMarked && (
                  <span className="pin-mark" aria-hidden>
                    <Check size={12} />
                  </span>
                )}
              </button>
            );
          }

          return (
            <div
              key={item.id}
              data-pin={item.id}
              role="group"
              aria-label={`${label} ${n + 1}`}
              tabIndex={0}
              className={`pin${isSelected ? " is-selected" : ""}${lifted ? " is-lifted" : ""}`}
              style={style}
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
              {photo}
              {holderEl}
              {isSelected && (
                <>
                  <button
                    type="button"
                    className="pin-remove"
                    aria-label="Take this photo off the board"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      onRemove?.(item.id);
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
    </div>
  );
}
