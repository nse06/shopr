import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatPrice, type Listing } from '../lib/api';
import { useTheme } from '../lib/theme';

const SOURCE_LABEL: Record<string, string> = { shopify: 'Shop', ebay: 'eBay', etsy: 'Etsy' };

export function sourceLabel(listing: Listing): string {
  return listing.source === 'shopify' ? listing.store : (SOURCE_LABEL[listing.source] ?? listing.source);
}

/** One listing in the shopping grid: photo, price, title, where it's from, and a save heart. */
export function ListingCard({
  listing,
  imageUrl,
  width,
  onOpen,
  onToggleSave,
}: {
  listing: Listing;
  imageUrl: string | null;
  width: number;
  onOpen: () => void;
  onToggleSave: () => void;
}) {
  const t = useTheme();
  const sizes = listing.sizes.slice(0, 3).join(' · ');
  return (
    <Pressable onPress={onOpen} style={{ width }} accessibilityRole="link" accessibilityLabel={`Open ${listing.title}`}>
      <View>
        <Image
          source={imageUrl ?? undefined}
          style={[styles.image, { backgroundColor: t.card }]}
          contentFit="cover"
          transition={120}
          recyclingKey={listing.id}
        />
        <Pressable
          onPress={onToggleSave}
          style={styles.heart}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={listing.saved ? 'Remove from saved' : 'Save'}
        >
          <Ionicons name={listing.saved ? 'heart' : 'heart-outline'} size={20} color={listing.saved ? '#ff4d6d' : '#fff'} />
        </Pressable>
      </View>
      <Text style={[styles.price, { color: t.text }]}>{formatPrice(listing.price, listing.currency)}</Text>
      <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
        {listing.title}
      </Text>
      <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>
        {sourceLabel(listing)}
        {sizes ? ` · ${sizes}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 4 / 5, borderRadius: 10 },
  heart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  price: { fontSize: 15, fontWeight: '700', marginTop: 6 },
  title: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 12, marginTop: 2 },
});
