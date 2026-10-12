import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useRun } from '../../components/RunBanner';
import { Button, ErrorText, Field, Muted, Section } from '../../components/ui';
import { normalizeServer, type Connection, type Prefs, type Stats, type Status, type Store } from '../../lib/api';
import { useApp } from '../../lib/context';
import { useTheme } from '../../lib/theme';

function pct(n: number | null | undefined): string {
  return n == null ? '–' : `${Math.round(n * 100)}%`;
}

export default function SetupScreen() {
  const t = useTheme();
  const { api, connection, setConnection, ready, bumpFeed } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [draft, setDraft] = useState({ min: '', max: '', sizes: '', exclude: '' });
  const [stores, setStores] = useState<Store[]>([]);
  const [newStore, setNewStore] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!api.configured) return;
    try {
      const [s, st, p, so] = await Promise.all([api.status(), api.stats(), api.prefs(), api.stores()]);
      setStatus(s);
      setStats(st);
      setPrefs(p);
      setDraft({
        min: p.min_price?.toString() ?? '',
        max: p.max_price?.toString() ?? '',
        sizes: p.size_terms.join(', '),
        exclude: p.exclude_terms.join(', '),
      });
      setStores(so);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
    }
  }, [api]);

  const { run, track } = useRun(() => load());

  useFocusEffect(
    useCallback(() => {
      if (ready) load();
    }, [ready, load]),
  );

  const savePrefs = async (update: Partial<Prefs>) => {
    setSaving(true);
    try {
      setPrefs(await api.setPrefs(update));
      bumpFeed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const storeAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setStores(await api.stores());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const refreshAll = async () => {
    try {
      track((await api.refresh(true)).run);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ours = stats?.ours;
  const base = stats?.baseline;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <Section title="Server">
          {Platform.OS === 'web' && !connection.serverUrl ? (
            <Muted>Connected to the server that hosts this page.</Muted>
          ) : (
            <Muted>
              The address of the shopr server on your computer, e.g. http://192.168.1.20:8000 on the same Wi-Fi, or a
              tunnel URL.
            </Muted>
          )}
          {Platform.OS !== 'web' && (
            // Keyed so the form resets to the saved values once they load from storage.
            <ConnectionForm key={`${connection.serverUrl}|${connection.token}`} initial={connection} onSave={setConnection} />
          )}
          <ErrorText message={error} />
          {status && (
            <View style={{ gap: 4 }}>
              <Muted>Image model: {status.embedder}</Muted>
              <Muted>
                Sources: Shopify shops ({status.counts.stores}) · eBay {status.sources.ebay ? 'on' : 'off'} · Etsy{' '}
                {status.sources.etsy ? 'on' : 'off'} · Claude queries {status.sources.claude ? 'on' : 'off'}
              </Muted>
              <Muted>
                {status.counts.listings} listings stored, {status.counts.analyzed} analyzed
              </Muted>
            </View>
          )}
        </Section>

        {stats && (
          <Section title="Is it working?">
            <Muted>
              The feed blindly mixes shopr’s taste ranking with plain keyword search (what you’d get typing the same
              searches into the shops). If shopr’s picks get liked a lot more often, the idea works.
            </Muted>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: t.accent }]}>{pct(ours?.like_rate)}</Text>
                <Muted style={{ textAlign: 'center' }}>
                  shopr picks liked{'\n'}({ours?.like ?? 0}/{ours?.rated ?? 0})
                </Muted>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: t.muted }]}>{pct(base?.like_rate)}</Text>
                <Muted style={{ textAlign: 'center' }}>
                  keyword search liked{'\n'}({base?.like ?? 0}/{base?.rated ?? 0})
                </Muted>
              </View>
            </View>
            <Muted>
              Of the first {stats.ours_first_50.rated} shopr picks you rated, you liked {stats.ours_first_50.liked}. Rate at
              least 50 of each for a fair read.
            </Muted>
          </Section>
        )}

        {prefs && (
          <Section title="Filters">
            <View style={styles.row}>
              <Field value={draft.min} onChangeText={(min) => setDraft({ ...draft, min })} placeholder="Min $" inputMode="numeric" style={{ flex: 1 }} />
              <Field value={draft.max} onChangeText={(max) => setDraft({ ...draft, max })} placeholder="Max $" inputMode="numeric" style={{ flex: 1 }} />
            </View>
            <Field value={draft.sizes} onChangeText={(sizes) => setDraft({ ...draft, sizes })} placeholder="Your sizes, e.g. M, 38, 32 (blank = any)" />
            <Muted style={{ fontSize: 13 }}>Listings with no size info are kept.</Muted>
            <Field value={draft.exclude} onChangeText={(exclude) => setDraft({ ...draft, exclude })} placeholder="Hide titles containing…" />
            <Button
              title="Apply filters"
              loading={saving}
              onPress={() =>
                savePrefs({
                  min_price: draft.min.trim() ? Number(draft.min) : null,
                  max_price: draft.max.trim() ? Number(draft.max) : null,
                  size_terms: splitList(draft.sizes),
                  exclude_terms: splitList(draft.exclude),
                })
              }
            />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>Blind test mode</Text>
                <Muted style={{ fontSize: 13 }}>Mix in keyword-search results to measure the ranking.</Muted>
              </View>
              <Switch value={prefs.blind_test} onValueChange={(v) => savePrefs({ blind_test: v })} />
            </View>
          </Section>
        )}

        {status && (
          <Section title={`Shops · ${stores.filter((s) => s.enabled).length} on`}>
            <Muted>
              Independent vintage and archive shops on Shopify. shopr pulls their whole catalog and ranks it against your
              board.
            </Muted>
            <View style={styles.row}>
              <Field value={newStore} onChangeText={setNewStore} placeholder="shop-domain.com" style={{ flex: 1 }} inputMode="url" />
              <Button
                title="Add"
                variant="secondary"
                disabled={!newStore.trim()}
                onPress={() =>
                  storeAction(async () => {
                    await api.addStore(newStore.trim());
                    setNewStore('');
                  })
                }
              />
            </View>
            {stores.map((s) => (
              <View key={s.domain} style={[styles.storeRow, { borderColor: t.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text }}>{s.name || s.domain}</Text>
                  <Muted style={{ fontSize: 12 }}>
                    {s.domain}
                    {s.last_fetched ? ` · ${s.listings} in stock` : ''}
                  </Muted>
                </View>
                <Switch value={s.enabled} onValueChange={(v) => storeAction(() => api.setStoreEnabled(s.domain, v))} />
                <Pressable onPress={() => storeAction(() => api.deleteStore(s.domain))} accessibilityRole="button" hitSlop={8}>
                  <Text style={{ color: t.nope }}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        )}

        {status && (
          <Section title="Last search">
            {run ? (
              <>
                <Muted>
                  Status: {run.status}
                  {run.detail.queries?.length ? ` · searches: ${run.detail.queries.join(', ')}` : ''}
                </Muted>
                <Text style={[styles.log, { color: t.muted }]}>{(run.detail.log ?? []).slice(-12).join('\n')}</Text>
                {!!run.detail.errors?.length && (
                  <Text style={[styles.log, { color: t.nope }]}>{run.detail.errors.slice(0, 8).join('\n')}</Text>
                )}
              </>
            ) : (
              <Muted>No searches yet.</Muted>
            )}
            <Button
              title="Re-pull all shop catalogs now"
              variant="secondary"
              onPress={refreshAll}
              disabled={run?.status === 'running'}
            />
          </Section>
        )}
      </View>
    </ScrollView>
  );
}

function ConnectionForm({ initial, onSave }: { initial: Connection; onSave: (c: Connection) => Promise<void> }) {
  const [server, setServer] = useState(initial.serverUrl);
  const [token, setToken] = useState(initial.token);
  return (
    <>
      <Field value={server} onChangeText={setServer} placeholder="http://192.168.1.20:8000" inputMode="url" />
      <Field value={token} onChangeText={setToken} placeholder="Access token (if SHOPR_TOKEN is set)" secureTextEntry />
      <Button title="Save and connect" onPress={() => onSave({ serverUrl: normalizeServer(server), token: token.trim() })} />
    </>
  );
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 640 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statsRow: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 32, fontWeight: '800' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingTop: 10 },
  log: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 17 },
});
