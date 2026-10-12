import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Run } from '../lib/api';
import { useApp } from '../lib/context';
import { useTheme } from '../lib/theme';

/** Polls the latest search run; calls onDone once each time a run finishes. */
export function useRun(onDone?: (run: Run) => void) {
  const { api } = useApp();
  const [run, setRun] = useState<Run | null>(null);
  const finished = useEffectEvent((r: Run) => onDone?.(r));
  // Poll quickly for a while after this screen starts a run.
  const fastUntil = useRef(0);
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    if (!api.configured) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // The id of the newest run already known to be finished, so each run reports once.
    let reportedId: number | null = null;
    let initialized = false;
    const tick = async () => {
      clearTimeout(timer);
      let running = false;
      try {
        const r = await api.latestRun();
        if (cancelled) return;
        setRun(r);
        running = r?.status === 'running';
        if (!initialized) {
          initialized = true;
          reportedId = r && !running ? r.id : null;
        } else if (r && !running && r.id !== reportedId) {
          reportedId = r.id;
          finished(r);
        }
      } catch {
        // Server unreachable; the screen shows its own error.
      }
      if (!cancelled) timer = setTimeout(tick, running || Date.now() < fastUntil.current ? 1500 : 6000);
    };
    pollNow.current = tick;
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api]);

  /** Call after starting a run so the banner shows it immediately. */
  const track = useCallback((r: Run | null) => {
    if (r) setRun(r);
    fastUntil.current = Date.now() + 15000;
    pollNow.current();
  }, []);

  return { run, track };
}

export function RunBanner({ run }: { run: Run | null }) {
  const t = useTheme();
  if (!run || run.status !== 'running') return null;
  const last = run.detail?.log?.at(-1)?.replace(/^\d\d:\d\d:\d\d /, '') ?? 'Starting';
  return (
    <View style={[styles.banner, { backgroundColor: t.card, borderColor: t.border }]}>
      <ActivityIndicator color={t.accent} />
      <Text style={{ color: t.text, flex: 1 }} numberOfLines={2}>
        Finding listings: {last}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
});
