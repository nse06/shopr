import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ErrorText, Muted } from '../../components/ui';
import { formatPrice, type Listing } from '../../lib/api';
import { useApp } from '../../lib/context';
import { openListing } from '../../lib/open';
import { useTheme } from '../../lib/theme';

export default function SavedScreen() {
  const t = useTheme();
  const { api, ready } = useApp();
  const { width } = useWindowDimensions();
  const [likes, setLikes] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!ready || !api.configured) return;
      api
        .likes()
        .then((l) => {
          setLikes(l);
          setError(null);
        })
        .catch((e) => setError((e as Error).message));
    }, [api, ready]),
  );

  const columns = width > 900 ? 4 : width > 600 ? 3 : 2;
  const tile = Math.floor((Math.min(width, 1000) - 32 - (columns - 1) * 10) / columns);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.container}>
      <View style={styles.inner}>
        <ErrorText message={error} />
        {likes.length === 0 ? (
          <Muted style={{ textAlign: 'center', marginTop: 40 }}>Items you like in the feed show up here.</Muted>
        ) : (
          <View style={styles.grid}>
            {likes.map((l) => (
              <Pressable key={l.id} style={{ width: tile }} onPress={() => openListing(l.url)} accessibilityRole="link">
                <Image source={l.image ? api.url(l.image) : undefined} style={[styles.image, { backgroundColor: t.card }]} contentFit="cover" />
                <Text style={{ color: t.text, fontWeight: '700', marginTop: 6 }}>{formatPrice(l.price, l.currency)}</Text>
                <Text style={{ color: t.text }} numberOfLines={2}>
                  {l.title}
                </Text>
                <Muted style={{ fontSize: 12 }}>{l.source === 'shopify' ? l.store : l.source}</Muted>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 1000 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 18 },
  image: { width: '100%', aspectRatio: 4 / 5, borderRadius: 10 },
});
