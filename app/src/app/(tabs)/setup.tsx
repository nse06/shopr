import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useRun } from '../../components/RunBanner';
import { Button, ErrorText, Field, Muted, Section } from '../../components/ui';
import { normalizeServer, type Connection, type KeysIn, type Prefs, type Stats, type Status, type Store } from '../../lib/api';
import { useApp } from '../../lib/context';
import { openListing } from '../../lib/open';
import { useTheme } from '../../lib/theme';

type SourceName = 'ebay' | 'etsy' | 'claude';

export default function SetupScreen() {
  const t = useTheme();
  const { api, connection, setConnection, ready, bumpFeed } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [newStore, setNewStore] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api.configured) return;
    try {
      const [s, st, p, so] = await Promise.all([api.status(), api.stats(), api.prefs(), api.stores()]);
      setStatus(s);
      setStats(st);
      setPrefs(p);
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

  const savePref = async (update: Partial<Prefs>) => {
    try {
      setPrefs(await api.setPrefs(update));
      bumpFeed();
    } catch (e) {
      setError((e as Error).message);
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

  const searchAgain = async () => {
    try {
      track((await api.refresh(true)).run);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const connect = async (keys: KeysIn) => {
    const res = await api.saveKeys(keys); // throws with the server's explanation if a key is rejected
    setStatus((s) => (s ? { ...s, sources: res.sources } : s));
  };

  const disconnect = async (source: SourceName) => {
    try {
      const res = await api.forgetKeys(source);
      setStatus((s) => (s ? { ...s, sources: res.sources } : s));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sources = status?.sources;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <Section title="Server">
          {Platform.OS === 'web' && !connection.serverUrl ? (
            <Muted>Connected to the shopr server running on this computer.</Muted>
          ) : (
            <Muted>
              The address shown in the shopr window on your computer, e.g. http://192.168.1.20:8000. Your phone needs to be on
              the same Wi-Fi.
            </Muted>
          )}
          {Platform.OS !== 'web' && (
            // Keyed so the form resets to the saved values once they load from storage.
            <ConnectionForm key={`${connection.serverUrl}|${connection.token}`} initial={connection} onSave={setConnection} />
          )}
          <ErrorText message={error} />
          {status && <Muted>Image matching: {status.embedder === 'ready' ? 'ready' : status.embedder}</Muted>}
        </Section>

        {sources && (
          <Section title="Where shopr searches">
            <SourceBlock
              name="eBay"
              connected={sources.ebay}
              blurb="The biggest secondhand marketplace. shopr searches it with your styles and your moodboard photos."
              steps={[
                { text: 'Make a free account at developer.ebay.com', url: 'https://developer.ebay.com/signin' },
                { text: 'Open "Application Keys" and create a Production keyset (any name, e.g. shopr)', url: 'https://developer.ebay.com/my/keys' },
                { text: 'Paste the App ID (Client ID) and Cert ID (Client Secret) below' },
              ]}
              fields={[
                { key: 'ebay_client_id', label: 'App ID (Client ID)' },
                { key: 'ebay_client_secret', label: 'Cert ID (Client Secret)', secret: true },
              ]}
              onConnect={connect}
              onDisconnect={() => disconnect('ebay')}
            />
            <SourceBlock
              name="Etsy"
              optional
              connected={sources.etsy}
              blurb="Lots of real vintage."
              steps={[
                { text: 'Create an app at etsy.com/developers', url: 'https://www.etsy.com/developers/your-apps' },
                { text: 'Paste its keystring and shared secret below' },
              ]}
              fields={[
                { key: 'etsy_keystring', label: 'Keystring' },
                { key: 'etsy_shared_secret', label: 'Shared secret', secret: true },
              ]}
              onConnect={connect}
              onDisconnect={() => disconnect('etsy')}
            />
            <SourceBlock
              name="Smarter searches (Claude)"
              optional
              connected={sources.claude}
              blurb="Claude looks at your moodboard and writes better search terms. Uses a little paid API credit per search."
              steps={[{ text: 'Create an API key at console.anthropic.com', url: 'https://console.anthropic.com/settings/keys' }]}
              fields={[{ key: 'anthropic_api_key', label: 'API key', secret: true }]}
              onConnect={connect}
              onDisconnect={() => disconnect('claude')}
            />
            <Muted style={{ fontSize: 13 }}>
              Depop, Grailed, Poshmark and Vinted don&apos;t let apps search them. Use the links under Moodboard → Styles to
              open your searches there.
            </Muted>
          </Section>
        )}

        {status && prefs && (
          <Section title={`Independent shops · ${stores.filter((s) => s.enabled).length} on`}>
            <Muted>Vintage and archive shops that shopr searches directly. Add any shop that runs on Shopify.</Muted>
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
                  <Muted style={{ fontSize: 12 }}>{s.domain}</Muted>
                </View>
                <Switch value={s.enabled} onValueChange={(v) => storeAction(() => api.setStoreEnabled(s.domain, v))} />
                <Pressable onPress={() => storeAction(() => api.deleteStore(s.domain))} accessibilityRole="button" hitSlop={8}>
                  <Text style={{ color: t.nope }}>Remove</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>Scan whole shop catalogs</Text>
                <Muted style={{ fontSize: 13 }}>Finds things keyword search misses, but searches take several minutes.</Muted>
              </View>
              <Switch value={prefs.deep_scan} onValueChange={(v) => savePref({ deep_scan: v })} />
            </View>
          </Section>
        )}

        {stats && prefs && (
          <Section title="Is it working?">
            <Muted>
              Your feed secretly mixes shopr&apos;s picks with plain keyword-search results. If you open and save
              shopr&apos;s picks more often, matching by look beats keyword search.
            </Muted>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: t.accent }]}>{stats.ours.opens + stats.ours.saves}</Text>
                <Muted style={{ textAlign: 'center' }}>
                  shopr&apos;s picks{'\n'}{stats.ours.opens} opened · {stats.ours.saves} saved
                </Muted>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: t.muted }]}>{stats.baseline.opens + stats.baseline.saves}</Text>
                <Muted style={{ textAlign: 'center' }}>
                  keyword search{'\n'}{stats.baseline.opens} opened · {stats.baseline.saves} saved
                </Muted>
              </View>
            </View>
            <View style={styles.switchRow}>
              <Text style={{ color: t.text, flex: 1 }}>Run this comparison</Text>
              <Switch value={prefs.blind_test} onValueChange={(v) => savePref({ blind_test: v })} />
            </View>
          </Section>
        )}

        {status && (
          <Section title="Last search">
            {run ? (
              <>
                <Muted>
                  {run.status === 'running' ? 'Running' : run.status === 'done' ? 'Finished' : 'Stopped with an error'}
                  {run.detail.queries?.length ? ` · searched for: ${run.detail.queries.join(', ')}` : ''}
                </Muted>
                <Text style={[styles.log, { color: t.muted }]}>{(run.detail.log ?? []).slice(-10).join('\n')}</Text>
                {!!run.detail.errors?.length && (
                  <Text style={[styles.log, { color: t.nope }]}>{run.detail.errors.slice(0, 6).join('\n')}</Text>
                )}
              </>
            ) : (
              <Muted>No searches yet.</Muted>
            )}
            <Button title="Search again" variant="secondary" onPress={searchAgain} disabled={run?.status === 'running'} />
          </Section>
        )}
      </View>
    </ScrollView>
  );
}

function SourceBlock({
  name,
  connected,
  optional,
  blurb,
  steps,
  fields,
  onConnect,
  onDisconnect,
}: {
  name: string;
  connected: boolean;
  optional?: boolean;
  blurb: string;
  steps: { text: string; url?: string }[];
  fields: { key: keyof KeysIn; label: string; secret?: boolean }[];
  onConnect: (keys: KeysIn) => Promise<void>;
  onDisconnect: () => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(!optional && !connected);
  const [values, setValues] = useState<KeysIn>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConnect(values);
      setValues({});
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.source, { borderColor: t.border }]}>
      <View style={styles.row}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, flex: 1 }}>
          {name}
          {optional ? <Text style={{ color: t.muted, fontWeight: '400' }}> · optional</Text> : null}
        </Text>
        {connected ? (
          <Text style={{ color: t.like, fontWeight: '700' }}>Connected ✓</Text>
        ) : (
          !open && (
            <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: t.accent, fontWeight: '700' }}>Connect</Text>
            </Pressable>
          )
        )}
      </View>
      <Muted style={{ fontSize: 13 }}>{blurb}</Muted>
      {connected && (
        <Pressable onPress={onDisconnect} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: t.muted, fontSize: 13 }}>Disconnect</Text>
        </Pressable>
      )}
      {!connected && open && (
        <View style={{ gap: 8 }}>
          {steps.map((s, i) => (
            <Text key={s.text} style={{ color: t.text, lineHeight: 20 }}>
              {i + 1}.{' '}
              {s.url ? (
                <Text style={{ color: t.accent, textDecorationLine: 'underline' }} onPress={() => openListing(s.url!)}>
                  {s.text}
                </Text>
              ) : (
                s.text
              )}
            </Text>
          ))}
          {fields.map((f) => (
            <Field
              key={f.key}
              value={values[f.key] ?? ''}
              onChangeText={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))}
              placeholder={f.label}
              secureTextEntry={f.secret}
            />
          ))}
          <ErrorText message={error} />
          <Button
            title={busy ? 'Checking…' : `Connect ${name.split(' ')[0]}`}
            onPress={submit}
            loading={busy}
            disabled={fields.some((f) => !(values[f.key] ?? '').trim())}
          />
        </View>
      )}
    </View>
  );
}

function ConnectionForm({ initial, onSave }: { initial: Connection; onSave: (c: Connection) => Promise<void> }) {
  const [server, setServer] = useState(initial.serverUrl);
  const [token, setToken] = useState(initial.token);
  return (
    <>
      <Field value={server} onChangeText={setServer} placeholder="http://192.168.1.20:8000" inputMode="url" />
      <Field value={token} onChangeText={setToken} placeholder="Access token (only if you set SHOPR_TOKEN)" secureTextEntry />
      <Button title="Save and connect" onPress={() => onSave({ serverUrl: normalizeServer(server), token: token.trim() })} />
    </>
  );
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
  source: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  log: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 17 },
});
