import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import type { BoardItem } from '../lib/api';
import { useTheme } from '../lib/theme';

// Must match the server's layout (backend/shopr/pinboard.py).
export const BOARD_W = 1000;
const FRAME_SIDE = 8;
const FRAME_BOTTOM = 26;
const MIN_W = 110;
const MAX_W = 700;
const MAX_FIT_PX = 900; // on wide screens the board fits this width, not the whole window
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const HANDLE_PX = 28; // how close a touch must be to the resize corner
const TAP_SLOP = 6;

export type BoardPatch = Partial<Pick<BoardItem, 'x' | 'y' | 'w' | 'z'>>;
type Offset = { x: number; y: number };
type Size = { w: number; h: number };

type Drag = { px: number; py: number } & (
  | { mode: 'move'; id: number; x: number; y: number }
  | { mode: 'resize'; id: number; w: number }
  | { mode: 'pan'; start: Offset }
  | { mode: 'pinch'; zoom: number; dist: number; cx: number; cy: number; start: Offset }
);

function frameHeight(w: number, aspect: number) {
  return (w - 2 * FRAME_SIDE) * aspect + FRAME_SIDE + FRAME_BOTTOM;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function touchSpread(e: GestureResponderEvent) {
  const [a, b] = e.nativeEvent.touches;
  return {
    dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
    cx: (a.locationX + b.locationX) / 2,
    cy: (a.locationY + b.locationY) / 2,
  };
}

/**
 * A corkboard you pin photos to. Drag a photo to move it (it comes to the front),
 * drag the corner handle of the selected photo to resize it, drag the empty board
 * to scroll, and pinch (or use the +/- buttons, or ctrl+scroll on a computer) to zoom.
 * One touch handler on the board does all the hit-testing, so it behaves the same
 * on the phone and on the web.
 */
export function PinBoard({
  items,
  imageUrl,
  onChange,
  onDelete,
}: {
  items: BoardItem[];
  imageUrl: (path: string) => string;
  onChange: (id: number, patch: BoardPatch) => void;
  onDelete: (id: number) => void;
}) {
  const t = useTheme();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  // Positions mid-drag, before they're saved.
  const [overrides, setOverrides] = useState<Record<number, BoardPatch>>({});
  const canvasRef = useRef<View>(null);

  // Pixels per board unit at zoom 1: fit the board to the screen width (capped on wide screens).
  const fit = Math.min(size.w, MAX_FIT_PX) / BOARD_W;
  const scale = size.w ? fit * zoom : 0;
  const placed = items.map((it) => ({ ...it, ...overrides[it.id] }));
  const bottom = placed.reduce((m, it) => Math.max(m, it.y + frameHeight(it.w, it.aspect)), 0);

  const clampOffset = (o: Offset, s: number, sz: Size = size): Offset => {
    const cw = BOARD_W * s;
    const ch = (bottom + 160) * s;
    return {
      x: cw <= sz.w ? -(sz.w - cw) / 2 : clamp(o.x, 0, cw - sz.w),
      y: ch <= sz.h ? 0 : clamp(o.y, 0, ch - sz.h),
    };
  };

  // Touch handling. The board's View is the only touch target (photos ignore touches), so
  // locationX/Y are always relative to the board, and pageX/Y track how far a finger moved.
  const [drag, setDrag] = useState<Drag | null>(null);

  const pinchFrom = (e: GestureResponderEvent): Drag => ({ mode: 'pinch', zoom, ...touchSpread(e), start: offset, px: 0, py: 0 });

  const onGrant = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length >= 2) {
      setDrag(pinchFrom(e));
      return;
    }
    const { locationX: lx, locationY: ly, pageX: px, pageY: py } = e.nativeEvent;
    const sel = placed.find((it) => it.id === selected);
    if (sel) {
      const hx = (sel.x + sel.w) * scale - offset.x;
      const hy = (sel.y + frameHeight(sel.w, sel.aspect)) * scale - offset.y;
      if (Math.abs(lx - hx) < HANDLE_PX && Math.abs(ly - hy) < HANDLE_PX) {
        setDrag({ mode: 'resize', id: sel.id, w: sel.w, px, py });
        return;
      }
    }
    const bx = (lx + offset.x) / scale;
    const by = (ly + offset.y) / scale;
    const hit = [...placed]
      .sort((a, b) => b.z - a.z)
      .find((it) => bx >= it.x && bx <= it.x + it.w && by >= it.y && by <= it.y + frameHeight(it.w, it.aspect));
    if (hit) {
      const top = Math.max(...placed.map((it) => it.z)) + 1;
      setDrag({ mode: 'move', id: hit.id, x: hit.x, y: hit.y, px, py });
      setOverrides((o) => ({ ...o, [hit.id]: { ...o[hit.id], z: top } }));
    } else {
      setDrag({ mode: 'pan', start: offset, px, py });
    }
  };

  const onMove = (e: GestureResponderEvent) => {
    const d = drag;
    if (!d) return;
    if (e.nativeEvent.touches.length >= 2 && d.mode !== 'pinch') {
      setDrag(pinchFrom(e));
      return;
    }
    const dx = e.nativeEvent.pageX - d.px;
    const dy = e.nativeEvent.pageY - d.py;
    if (d.mode === 'move') {
      setOverrides((o) => ({ ...o, [d.id]: { ...o[d.id], x: d.x + dx / scale, y: d.y + dy / scale } }));
    } else if (d.mode === 'resize') {
      setOverrides((o) => ({ ...o, [d.id]: { ...o[d.id], w: clamp(d.w + dx / scale, MIN_W, MAX_W) } }));
    } else if (d.mode === 'pan') {
      setOffset(clampOffset({ x: d.start.x - dx, y: d.start.y - dy }, scale));
    } else if (e.nativeEvent.touches.length >= 2) {
      const { dist } = touchSpread(e);
      const z = clamp((d.zoom * dist) / Math.max(d.dist, 1), MIN_ZOOM, MAX_ZOOM);
      const oldScale = fit * d.zoom;
      const newScale = fit * z;
      // Keep the spot between the fingers where it is.
      const bx = (d.cx + d.start.x) / oldScale;
      const by = (d.cy + d.start.y) / oldScale;
      setZoom(z);
      setOffset(clampOffset({ x: bx * newScale - d.cx, y: by * newScale - d.cy }, newScale));
    }
  };

  const onEnd = (e: GestureResponderEvent) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const moved = Math.abs(e.nativeEvent.pageX - d.px) + Math.abs(e.nativeEvent.pageY - d.py) > TAP_SLOP;
    const finish = (id: number, patch: BoardPatch) => {
      onChange(id, patch);
      setOverrides((o) => {
        const { [id]: _done, ...rest } = o;
        return rest;
      });
    };
    if (d.mode === 'move') {
      const it = placed.find((i) => i.id === d.id);
      if (it) finish(d.id, moved ? { x: it.x, y: it.y, z: it.z } : { z: it.z });
      if (!moved) setSelected((cur) => (cur === d.id ? null : d.id));
    } else if (d.mode === 'resize') {
      const it = placed.find((i) => i.id === d.id);
      if (it) finish(d.id, { w: it.w });
    } else if (d.mode === 'pan' && !moved) {
      setSelected(null);
    }
  };

  const touchProps = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: onGrant,
    onResponderMove: onMove,
    onResponderRelease: onEnd,
    onResponderTerminate: onEnd,
  };

  // Mouse wheel scrolls the board on the web; ctrl/cmd + wheel (and trackpad pinch) zooms.
  const onWheel = useEffectEvent((ev: WheelEvent, node: HTMLElement) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      const z = clamp(zoom * Math.exp(-ev.deltaY / 300), MIN_ZOOM, MAX_ZOOM);
      const s = fit * z;
      const rect = node.getBoundingClientRect();
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      const bx = (cx + offset.x) / scale;
      const by = (cy + offset.y) / scale;
      setZoom(z);
      setOffset(clampOffset({ x: bx * s - cx, y: by * s - cy }, s));
    } else {
      setOffset(clampOffset({ x: offset.x + ev.deltaX, y: offset.y + ev.deltaY }, scale));
    }
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = canvasRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const listener = (ev: WheelEvent) => onWheel(ev, node);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const next = { w: width, h: height };
    setSize(next);
    setOffset((o) => clampOffset(o, (Math.min(width, MAX_FIT_PX) / BOARD_W) * zoom, next));
  };

  const zoomBy = (factor: number) => {
    const z = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const s = fit * z;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const bx = (cx + offset.x) / scale;
    const by = (cy + offset.y) / scale;
    setZoom(z);
    setOffset(clampOffset({ x: bx * s - cx, y: by * s - cy }, s));
  };

  const sel = placed.find((it) => it.id === selected);
  const pin = Math.max(10, 16 * scale);
  const cork = t.bg === '#141311' ? '#3b3128' : '#d8c3a1';

  return (
    <View style={{ flex: 1 }}>
      <View
        ref={canvasRef}
        onLayout={onLayout}
        style={[styles.canvas, { backgroundColor: cork }, Platform.OS === 'web' && styles.noSelect]}
        {...touchProps}
      >
        {scale > 0 &&
          [...placed]
            .sort((a, b) => a.z - b.z)
            .map((it) => {
              const w = it.w * scale;
              const inner = (it.w - 2 * FRAME_SIDE) * scale;
              return (
                <View
                  key={it.id}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: it.x * scale - offset.x,
                    top: it.y * scale - offset.y,
                    width: w,
                    zIndex: it.z,
                    transform: [{ rotate: `${it.rot}deg` }],
                  }}
                >
                  <View style={[styles.frame, { padding: FRAME_SIDE * scale, paddingBottom: FRAME_BOTTOM * scale }]}>
                    <Image source={imageUrl(it.image)} style={{ width: inner, height: inner * it.aspect }} contentFit="cover" />
                  </View>
                  {it.id === selected && <View style={[styles.selectedRing, { borderColor: t.accent }]} />}
                  <View style={[styles.pin, { width: pin, height: pin, borderRadius: pin / 2, left: w / 2 - pin / 2, top: -pin * 0.4 }]}>
                    <View style={[styles.pinShine, { width: pin * 0.35, height: pin * 0.35, borderRadius: pin }]} />
                  </View>
                </View>
              );
            })}
        {sel && scale > 0 && (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.handle,
                {
                  backgroundColor: t.accent,
                  left: (sel.x + sel.w) * scale - offset.x - 13,
                  top: (sel.y + frameHeight(sel.w, sel.aspect)) * scale - offset.y - 13,
                  zIndex: 100000,
                },
              ]}
            >
              <Ionicons name="resize" size={14} color={t.accentText} />
            </View>
            <Pressable
              onPress={() => {
                setSelected(null);
                onDelete(sel.id);
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove photo from moodboard"
              hitSlop={8}
              style={[
                styles.remove,
                { left: (sel.x + sel.w) * scale - offset.x - 14, top: sel.y * scale - offset.y - 14, zIndex: 100000 },
              ]}
            >
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
          </>
        )}
        {items.length === 0 && (
          <View pointerEvents="none" style={styles.emptyNote}>
            <Text style={styles.emptyText}>Your board is empty. Add photos of clothes you like, then arrange them however you want.</Text>
          </View>
        )}
      </View>
      <View style={styles.zoomBar}>
        <Pressable onPress={() => zoomBy(1 / 1.25)} style={[styles.zoomBtn, { backgroundColor: t.card }]} accessibilityLabel="Zoom out">
          <Ionicons name="remove" size={18} color={t.text} />
        </Pressable>
        <Pressable
          onPress={() => {
            setZoom(1);
            setOffset(clampOffset({ x: 0, y: offset.y / zoom }, fit));
          }}
          style={[styles.zoomBtn, { backgroundColor: t.card }]}
          accessibilityLabel="Fit to width"
        >
          <Ionicons name="scan-outline" size={16} color={t.text} />
        </Pressable>
        <Pressable onPress={() => zoomBy(1.25)} style={[styles.zoomBtn, { backgroundColor: t.card }]} accessibilityLabel="Zoom in">
          <Ionicons name="add" size={18} color={t.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  noSelect: { userSelect: 'none' } as object,
  frame: {
    backgroundColor: '#fffdf8',
    borderRadius: 2,
    boxShadow: '0px 3px 8px rgba(0, 0, 0, 0.28)',
  },
  selectedRing: {
    position: 'absolute',
    left: -4,
    right: -4,
    top: -4,
    bottom: -4,
    borderWidth: 2,
    borderRadius: 4,
  },
  pin: {
    position: 'absolute',
    backgroundColor: '#c0392b',
    borderWidth: 1,
    borderColor: '#7b1f16',
    boxShadow: '0px 2px 3px rgba(0, 0, 0, 0.35)',
  },
  pinShine: { position: 'absolute', top: '18%', left: '20%', backgroundColor: 'rgba(255,255,255,0.7)' },
  handle: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyNote: { position: 'absolute', left: 24, right: 24, top: 60, alignItems: 'center' },
  emptyText: { color: '#5c4a35', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  zoomBar: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 6 },
  zoomBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.25)',
  },
});
