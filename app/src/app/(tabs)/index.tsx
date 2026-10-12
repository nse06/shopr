import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { RunBanner, useRun } from '../../components/RunBanner';
import { Button, Chip, ErrorText, Muted } from '../../components/ui';
import { formatPrice, type Listing } from '../../lib/api';
import { useApp } from '../../lib/context';
import { openListing } from '../../lib/open';
import { useTheme } from '../../lib/theme';

const SOURCE_LABEL: Record<string, string> = { shopify: 'Shop', ebay: 'eBay', etsy: 'Etsy' };

export default function FeedScreen() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { api, ready, feedVersion, bumpFeed } = useApp();
  const [items, setItems] = useState<Listing[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState<number | null>(null);
  const [history, setHistory] = useState<Listing[]>([]);
  const busy = useRef(false);
  const { run, track } = useRun(() => bumpFeed());

  const load = useCallback((): Promise<void> => {
    if (!api.configured) return Promise.resolve();
    // State is only set in the promise callbacks, never synchronously.
    return api.feed(0, 30).then(
      (res) => {
        setItems(res.items);
        setRemaining(res.remaining);
        setError(null);
        setLoading(false);
      },
      (e: Error) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [api]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load, feedVersion]);

  // Pick up changes made on other tabs (filters, moodboard).
  useFocusEffect(
    useCallback(() => {
      if (ready) load();
    }, [ready, load]),
  );

  const current = items[0];

  // Warm the cache for the next few photos so swiping feels instant.
  useEffect(() => {
    const next = items.slice(1, 4).map((i) => i.image).filter(Boolean) as string[];
    if (next.length) Image.prefetch(next);
  }, [items]);

  const rate = useCallback(
    async (action: 'like' | 'nope') => {
      if (!current || busy.current) return;
      busy.current = true;
      setItems((list) => list.slice(1));
      setRemaining((n) => Math.max(0, n - 1));
      setHistory((h) => [current, ...h].slice(0, 20));
      try {
        const res = await api.feedback(current.id, action);
        setRated(res.rated);
        if (res.reranked || items.length <= 5) await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busy.current = false;
      }
    },
    [api, current, items.length, load],
  );

  const undo = useCallback(async () => {
    const [last, ...rest] = history;
    if (!last) return;
    setHistory(rest);
    setItems((list) => [last, ...list]);
    setRemaining((n) => n + 1);
    try {
      await api.undoFeedback(last.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, history]);

  // Keyboard shortcuts on the web: ← pass, → like, ↵ open, ⌫ undo.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') rate('like');
      else if (e.key === 'ArrowLeft') rate('nope');
      else if (e.key === 'Enter' && current) openListing(current.url);
      else if (e.key === 'Backspace') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rate, undo, current]);

  const startRefresh = async () => {
    try {
      const res = await api.refresh();
      track(res.run);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (ready && !api.configured) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={[styles.h1, { color: t.text }]}>Connect to your shopr server</Text>
        <Muted style={{ textAlign: 'center', marginBottom: 16 }}>
          The app talks to the shopr server running on your computer. Add its address in Setup.
        </Muted>
        <Button title="Go to Setup" onPress={() => router.navigate('/setup')} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.container}>
      <View style={styles.inner}>
        <RunBanner run={run} />
        <ErrorText message={error} />
        {loading && !current ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.accent} />
        ) : current ? (
          <>
            <ListingCard listing={current} imageUrl={current.image ? api.url(current.image) : null} />
            <View style={styles.actions}>
              <Button title="Pass" variant="nope" onPress={() => rate('nope')} style={{ flex: 1 }} />
              <Button title="Like" variant="like" onPress={() => rate('like')} style={{ flex: 1 }} />
            </View>
            <View style={styles.meta}>
              <Muted>
                {remaining} left{rated != null ? ` · ${rated} rated` : ''}
              </Muted>
              {history.length > 0 && (
                <Pressable onPress={undo} accessibilityRole="button">
                  <Text style={{ color: t.accent, fontWeight: '600' }}>Undo</Text>
                </Pressable>
              )}
            </View>
            {Platform.OS === 'web' && width > 700 && <Muted style={{ textAlign: 'center' }}>Keys: ← pass · → like · Enter open · Backspace undo</Muted>}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.h1, { color: t.text }]}>{run?.status === 'running' ? 'Searching…' : 'Nothing to rate yet'}</Text>
            <Muted style={{ textAlign: 'center', marginBottom: 16 }}>
              Add images to your moodboard, then search the shops. The first search pulls whole shop catalogs and can
              take several minutes.
            </Muted>
            <Button title="Find listings" onPress={startRefresh} disabled={run?.status === 'running'} />
          </View>
        )}
        {current && (
          <Button
            title={run?.status === 'running' ? 'Searching…' : 'Search again for new listings'}
            variant="secondary"
            onPress={startRefresh}
            disabled={run?.status === 'running'}
            style={{ marginTop: 24 }}
          />
        )}
      </View>
    </ScrollView>
  );
}

function ListingCard({ listing, imageUrl }: { listing: Listing; imageUrl: string | null }) {
  const t = useTheme();
  const details = [listing.brand, listing.condition, listing.era].filter((d) => d && d.toLowerCase() !== 'vintage');
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Pressable onPress={() => openListing(listing.url)} accessibilityRole="link" accessibilityLabel={`Open ${listing.title}`}>
        <Image source={imageUrl ?? undefined} style={styles.image} contentFit="contain" transition={120} />
      </Pressable>
      <View style={styles.cardBody}>
        <View style={styles.row}>
          <Text style={[styles.price, { color: t.text }]}>{formatPrice(listing.price, listing.currency)}</Text>
          <Muted>
            {SOURCE_LABEL[listing.source] ?? listing.source}
            {listing.source === 'shopify' ? ` · ${listing.store}` : ''}
          </Muted>
        </View>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={3}>
          {listing.title}
        </Text>
        <View style={styles.chips}>
          {listing.sizes.slice(0, 6).map((s) => (
            <Chip key={s} label={s} />
          ))}
          {details.map((d) => (
            <Chip key={d!} label={d!} />
          ))}
        </View>
        <Pressable onPress={() => openListing(listing.url)} accessibilityRole="link">
          <Text style={{ color: t.accent, fontWeight: '600', marginTop: 4 }}>Open listing ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 520 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 4 / 5, backgroundColor: '#e9e5de' },
  cardBody: { padding: 14, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  price: { fontSize: 20, fontWeight: '700' },
  title: { fontSize: 16, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, marginBottom: 6 },
  empty: { alignItems: 'center', paddingVertical: 48 },
});
