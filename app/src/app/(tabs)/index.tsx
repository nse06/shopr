import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { FiltersSheet, filtersSummary, type Filters } from '../../components/FiltersSheet';
import { ListingCard } from '../../components/ListingCard';
import { RunBanner, useRun } from '../../components/RunBanner';
import { Button, ErrorText, Muted } from '../../components/ui';
import type { Listing, Prefs } from '../../lib/api';
import { useApp } from '../../lib/context';
import { openListing } from '../../lib/open';
import { useTheme } from '../../lib/theme';

const PAGE = 40;
const GAP = 12;
const PAD = 16;

export default function ShopScreen() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { api, ready, feedVersion, bumpFeed } = useApp();
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [boardCount, setBoardCount] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { run, track } = useRun(() => bumpFeed());
  const running = run?.status === 'running';
  // When filters were last saved: a slower load that started earlier must not undo them.
  const prefsSavedAt = useRef(0);

  const columns = width >= 1200 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const contentWidth = Math.min(width, 1400);
  const cardWidth = Math.floor((contentWidth - PAD * 2 - GAP * (columns - 1)) / columns);

  // State is only set in promise callbacks, never synchronously (keeps effects simple).
  const load = useCallback((): Promise<void> => {
    if (!api.configured) return Promise.resolve();
    const started = Date.now();
    return Promise.all([api.feed(0, PAGE), api.prefs(), api.status()]).then(
      ([feed, p, status]) => {
        setItems(feed.items);
        setTotal(feed.total);
        if (started >= prefsSavedAt.current) setPrefs(p);
        setBoardCount(status.counts.board);
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

  useFocusEffect(
    useCallback(() => {
      if (ready) load();
    }, [ready, load]),
  );

  // During a search the grid fills in batches: refresh the first screenful as progress comes in.
  const progress = running ? (run?.detail?.log?.length ?? 0) : -1;
  useEffect(() => {
    if (ready && progress > 0 && items.length < 24) load();
  }, [ready, progress, items.length, load]);

  // Warm the image cache for the first rows.
  useEffect(() => {
    const next = items.slice(0, 12).map((i) => i.image).filter(Boolean) as string[];
    if (next.length) Image.prefetch(next);
  }, [items]);

  const loadMore = () => {
    if (items.length >= total || loading) return;
    api.feed(items.length, PAGE).then(
      (res) => {
        setItems((cur) => {
          const seen = new Set(cur.map((i) => i.id));
          return [...cur, ...res.items.filter((i) => !seen.has(i.id))];
        });
        setTotal(res.total);
      },
      (e: Error) => setError(e.message),
    );
  };

  const startSearch = async () => {
    try {
      track((await api.refresh()).run);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveFilters = async (f: Filters) => {
    setShowFilters(false);
    prefsSavedAt.current = Date.now();
    try {
      setPrefs(await api.setPrefs({ ...f, onboarded: true }));
      if (boardCount && !running) await startSearch();
      else load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleSave = (item: Listing) => {
    const saved = !item.saved;
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, saved } : i)));
    (saved ? api.save(item.id) : api.unsave(item.id)).catch((e: Error) => setError(e.message));
  };

  const open = (item: Listing) => {
    api.opened(item.id).catch(() => {});
    openListing(item.url);
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

  const needsFilters = prefs != null && !prefs.onboarded;
  const header = (
    <View style={{ gap: 10, marginBottom: 14 }}>
      {prefs && (
        <View style={[styles.filterBar, { borderColor: t.border, backgroundColor: t.card }]}>
          <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>
            {filtersSummary(prefs)}
          </Text>
          <Pressable onPress={() => setShowFilters(true)} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: t.accent, fontWeight: '700' }}>Edit</Text>
          </Pressable>
        </View>
      )}
      <RunBanner run={run} />
      <ErrorText message={error} />
    </View>
  );

  const empty = loading ? (
    <ActivityIndicator style={{ marginTop: 40 }} color={t.accent} />
  ) : boardCount === 0 ? (
    <View style={styles.empty}>
      <Text style={[styles.h1, { color: t.text }]}>Start with your moodboard</Text>
      <Muted style={{ textAlign: 'center', marginBottom: 16 }}>
        Pin photos of clothes you like, then come back here to see listings that match.
      </Muted>
      <Button title="Go to Moodboard" onPress={() => router.navigate('/board')} />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={[styles.h1, { color: t.text }]}>{running ? 'Searching…' : 'No listings yet'}</Text>
      <Muted style={{ textAlign: 'center', marginBottom: 16 }}>
        {running
          ? 'shopr is checking listing photos against your moodboard. The first matches show up here within a minute.'
          : 'Search the shops for listings that match your moodboard.'}
      </Muted>
      {!running && <Button title="Find listings" onPress={needsFilters ? () => setShowFilters(true) : startSearch} />}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        key={columns}
        data={items}
        numColumns={columns}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            imageUrl={item.image ? api.url(item.image) : null}
            width={cardWidth}
            onOpen={() => open(item)}
            onToggleSave={() => toggleSave(item)}
          />
        )}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        contentContainerStyle={[styles.list, { width: contentWidth }]}
        style={{ alignSelf: 'center', width: '100%' }}
        ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          items.length > 0 ? (
            <View style={{ marginTop: 24, gap: 8 }}>
              {items.length < total && <Muted style={{ textAlign: 'center' }}>Loading more…</Muted>}
              <Button
                title={running ? 'Searching…' : 'Search again for new listings'}
                variant="secondary"
                onPress={startSearch}
                disabled={running}
              />
            </View>
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
      />
      {(showFilters || (needsFilters && boardCount !== 0)) && prefs && (
        <FiltersSheet
          visible
          initial={prefs}
          firstTime={needsFilters}
          onSave={saveFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: PAD, paddingBottom: 40, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 12 },
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
});
