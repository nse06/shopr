import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ListingCard } from '../../components/ListingCard';
import { ErrorText, Muted } from '../../components/ui';
import type { Listing } from '../../lib/api';
import { useApp } from '../../lib/context';
import { openListing } from '../../lib/open';
import { useTheme } from '../../lib/theme';

const GAP = 12;
const PAD = 16;

export default function SavedScreen() {
  const t = useTheme();
  const { api, ready } = useApp();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!ready || !api.configured) return;
      api.saved().then(
        (l) => {
          setItems(l);
          setError(null);
        },
        (e: Error) => setError(e.message),
      );
    }, [api, ready]),
  );

  const columns = width >= 1200 ? 5 : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const contentWidth = Math.min(width, 1400);
  const cardWidth = Math.floor((contentWidth - PAD * 2 - GAP * (columns - 1)) / columns);

  const toggleSave = (item: Listing) => {
    const saved = !item.saved;
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, saved } : i)));
    (saved ? api.save(item.id) : api.unsave(item.id)).catch((e: Error) => setError(e.message));
  };

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
            onOpen={() => {
              api.opened(item.id).catch(() => {});
              openListing(item.url);
            }}
            onToggleSave={() => toggleSave(item)}
          />
        )}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        contentContainerStyle={[styles.list, { width: contentWidth }]}
        style={{ alignSelf: 'center', width: '100%' }}
        ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
        ListHeaderComponent={<ErrorText message={error} />}
        ListEmptyComponent={
          <Muted style={{ textAlign: 'center', marginTop: 40 }}>Tap the ♡ on a listing to save it here.</Muted>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: PAD, paddingBottom: 40, alignSelf: 'center' },
});
