import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Button, Chip, ErrorText, Field, Muted, Section } from '../../components/ui';
import type { BoardItem, Cluster } from '../../lib/api';
import { useApp } from '../../lib/context';
import { useTheme } from '../../lib/theme';

export default function BoardScreen() {
  const t = useTheme();
  const { api, ready } = useApp();
  const { width } = useWindowDimensions();
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      setClusters((await api.profile()).clusters);
    } catch {
      // The profile needs the image model; it fills in once the server is ready.
    }
  }, [api]);

  const load = useCallback(async () => {
    if (!api.configured) return;
    try {
      setBoard(await api.board());
      setError(null);
      loadProfile();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, loadProfile]);

  useFocusEffect(
    useCallback(() => {
      if (ready) load();
    }, [ready, load]),
  );

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 30,
      quality: 0.8,
      // Ask iOS for JPEG/H.264 rather than HEIC/HEVC where it can.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets.length) return;
    const form = new FormData();
    result.assets.forEach((a, i) => {
      const isVideo = a.type === 'video';
      const name = a.fileName ?? `${isVideo ? 'clip' : 'photo'}-${i}.${isVideo ? 'mp4' : 'jpg'}`;
      if (Platform.OS === 'web' && a.file) {
        form.append('files', a.file, name);
      } else {
        // React Native's FormData accepts a { uri, name, type } file descriptor.
        form.append('files', { uri: a.uri, name, type: a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg') } as unknown as Blob);
      }
    });
    setBusy(`Adding ${result.assets.length} item${result.assets.length > 1 ? 's' : ''}…`);
    try {
      const res = await api.upload(form);
      setBoard(res.board);
      setError(res.errors.length ? res.errors.join('\n') : null);
      loadProfile();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addLink = async () => {
    if (!link.trim()) return;
    setBusy('Fetching link…');
    try {
      const res = await api.addUrl(link.trim());
      setBoard(res.board);
      setLink('');
      setError(null);
      loadProfile();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    try {
      setBoard((await api.deleteBoardItem(id)).board);
      loadProfile();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const columns = width > 900 ? 6 : width > 600 ? 4 : 3;
  const contentWidth = Math.min(width, 900) - 32 - 34;
  const tile = Math.floor((contentWidth - (columns - 1) * 6) / columns);

  if (ready && !api.configured) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Muted>Add your server address in Setup first.</Muted>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <Section title="Add to your moodboard">
          <Muted>
            Photos, screenshots and short videos of clothes you like. Outfit pics, Pinterest saves, old favourites. Aim for
            20–30; more variety gives better results.
          </Muted>
          <Button title={busy ?? 'Choose photos or videos'} onPress={pick} loading={!!busy} />
          <View style={styles.linkRow}>
            <Field
              value={link}
              onChangeText={setLink}
              placeholder="…or paste a link (Pinterest pin, product page, image URL)"
              onSubmitEditing={addLink}
              style={{ flex: 1 }}
              inputMode="url"
            />
            <Button title="Add" variant="secondary" onPress={addLink} disabled={!link.trim() || !!busy} />
          </View>
          <ErrorText message={error} />
        </Section>

        <Section title={`Board · ${board.length}`}>
          {board.length === 0 ? (
            <Muted>Nothing here yet.</Muted>
          ) : (
            <View style={styles.grid}>
              {board.map((item) => (
                <View key={item.id} style={{ width: tile, height: tile * 1.25 }}>
                  <Image source={api.url(item.image)} style={styles.tileImage} contentFit="cover" />
                  {item.kind === 'video_frame' && (
                    <View style={styles.badge}>
                      <Ionicons name="videocam" size={12} color="#fff" />
                    </View>
                  )}
                  <Pressable
                    onPress={() => remove(item.id)}
                    style={styles.remove}
                    accessibilityRole="button"
                    accessibilityLabel="Remove from moodboard"
                    hitSlop={8}
                  >
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Section>

        {clusters.length > 0 && (
          <Section title="What shopr sees">
            <Muted>
              Your board split into {clusters.length} direction{clusters.length > 1 ? 's' : ''}. Each gets its own searches
              and share of the feed.
            </Muted>
            {clusters.map((c) => (
              <View key={c.index} style={[styles.cluster, { borderColor: t.border }]}>
                <View style={styles.clusterImages}>
                  {c.images.slice(0, 5).map((src) => (
                    <Image key={src} source={api.url(src)} style={styles.clusterThumb} contentFit="cover" />
                  ))}
                </View>
                {c.summary ? <Text style={{ color: t.text, lineHeight: 20 }}>{c.summary}</Text> : null}
                <View style={styles.chips}>
                  {[...(c.tags.garment ?? []), ...(c.tags.material ?? []), ...(c.tags.style ?? [])].map((tag) => (
                    <Chip key={tag} label={tag} />
                  ))}
                </View>
                <Muted style={{ fontSize: 13 }}>Searches: {c.queries.join(' · ')}</Muted>
              </View>
            ))}
          </Section>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 900 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  linkRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tileImage: { width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#ddd' },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 3 },
  cluster: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  clusterImages: { flexDirection: 'row', gap: 4 },
  clusterThumb: { width: 52, height: 64, borderRadius: 6, backgroundColor: '#ddd' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
