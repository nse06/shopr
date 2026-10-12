import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PinBoard, type BoardPatch } from '../../components/PinBoard';
import { Button, Chip, ErrorText, Field, Muted } from '../../components/ui';
import type { BoardItem, Cluster } from '../../lib/api';
import { useApp } from '../../lib/context';
import { openListing } from '../../lib/open';
import { useTheme } from '../../lib/theme';

// Sites without a way for apps to search them: open their own search page instead.
const ELSEWHERE: { name: string; url: (q: string) => string }[] = [
  { name: 'Depop', url: (q) => `https://www.depop.com/search/?q=${encodeURIComponent(q)}` },
  { name: 'Grailed', url: (q) => `https://www.grailed.com/shop?query=${encodeURIComponent(q)}` },
  { name: 'Poshmark', url: (q) => `https://poshmark.com/search?query=${encodeURIComponent(q)}&department=Men` },
  { name: 'Vinted', url: (q) => `https://www.vinted.com/catalog?search_text=${encodeURIComponent(q)}` },
  { name: 'eBay', url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
];

export default function BoardScreen() {
  const t = useTheme();
  const { api, ready } = useApp();
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [link, setLink] = useState('');

  const loadProfile = useCallback(() => {
    api.profile().then(
      (p) => setClusters(p.clusters),
      () => {}, // needs the image model; fills in once the server is ready
    );
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      if (!ready || !api.configured) return;
      api.board().then(
        (b) => {
          setBoard(b);
          setError(null);
        },
        (e: Error) => setError(e.message),
      );
      loadProfile();
    }, [ready, api, loadProfile]),
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
    setBusy(`Pinning ${result.assets.length} item${result.assets.length > 1 ? 's' : ''}…`);
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
    setLinkOpen(false);
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

  const change = (id: number, patch: BoardPatch) => {
    setBoard((b) => b.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    api.moveBoardItem(id, patch).catch((e: Error) => setError(e.message));
  };

  const remove = (id: number) => {
    setBoard((b) => b.filter((it) => it.id !== id));
    api.deleteBoardItem(id).then(
      (res) => {
        setBoard(res.board);
        loadProfile();
      },
      (e: Error) => setError(e.message),
    );
  };

  const tidy = async () => {
    try {
      setBoard((await api.arrangeBoard()).board);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (ready && !api.configured) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Muted>Add your server address in Setup first.</Muted>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.toolbarScroll, { borderColor: t.border }]}
        contentContainerStyle={styles.toolbar}
      >
        <ToolButton icon="add" label="Add" onPress={pick} primary disabled={!!busy} />
        <ToolButton icon="link" label="Link" onPress={() => setLinkOpen(true)} disabled={!!busy} />
        <ToolButton icon="grid-outline" label="Tidy" onPress={tidy} disabled={!board.length} />
        <ToolButton icon="sparkles-outline" label="Styles" onPress={() => setStylesOpen(true)} disabled={!clusters.length} />
      </ScrollView>
      {(busy || error) && (
        <View style={styles.status}>
          {busy && (
            <View style={styles.row}>
              <ActivityIndicator color={t.accent} />
              <Text style={{ color: t.text }}>{busy}</Text>
            </View>
          )}
          <ErrorText message={error} />
        </View>
      )}
      <PinBoard items={board} imageUrl={(p) => api.url(p)} onChange={change} onDelete={remove} />
      {board.length > 0 && (
        <View pointerEvents="none" style={[styles.hint, { backgroundColor: t.card }]}>
          <Text style={{ color: t.muted, fontSize: 12 }}>Drag photos to arrange · tap one to resize or remove</Text>
        </View>
      )}

      <Modal visible={linkOpen} transparent animationType="fade" onRequestClose={() => setLinkOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: t.bg, borderColor: t.border }]}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>Pin from a link</Text>
            <Muted>A Pinterest pin, a product page, or a direct image link. Instagram and TikTok usually block this; use a screenshot instead.</Muted>
            <Field value={link} onChangeText={setLink} placeholder="https://…" inputMode="url" onSubmitEditing={addLink} autoFocus />
            <View style={styles.row}>
              <Button title="Cancel" variant="secondary" onPress={() => setLinkOpen(false)} style={{ flex: 1 }} />
              <Button title="Pin it" onPress={addLink} disabled={!link.trim()} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={stylesOpen} transparent animationType="fade" onRequestClose={() => setStylesOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, styles.tallSheet, { backgroundColor: t.bg, borderColor: t.border }]}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.sheetTitle, { color: t.text }]}>Your styles</Text>
              <Pressable onPress={() => setStylesOpen(false)} accessibilityLabel="Close" hitSlop={10}>
                <Ionicons name="close" size={22} color={t.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 18 }}>
              <Muted>
                shopr found {clusters.length} style{clusters.length === 1 ? '' : 's'} on your board and searches for each. You
                can also open the same searches on sites shopr can&apos;t search for you.
              </Muted>
              {clusters.map((c) => (
                <View key={c.index} style={[styles.cluster, { borderColor: t.border }]}>
                  <View style={styles.thumbs}>
                    {c.images.slice(0, 5).map((src) => (
                      <Image key={src} source={api.url(src)} style={styles.thumb} contentFit="cover" />
                    ))}
                  </View>
                  {c.summary ? <Text style={{ color: t.text, lineHeight: 20 }}>{c.summary}</Text> : null}
                  <View style={styles.chips}>
                    {[...(c.tags.garment ?? []), ...(c.tags.material ?? []), ...(c.tags.style ?? [])].map((tag) => (
                      <Chip key={tag} label={tag} />
                    ))}
                  </View>
                  {c.queries.slice(0, 2).map((q) => (
                    <View key={q} style={{ gap: 6 }}>
                      <Text style={{ color: t.muted, fontSize: 13 }}>“{q}” on:</Text>
                      <View style={styles.chips}>
                        {ELSEWHERE.map((site) => (
                          <Pressable
                            key={site.name}
                            onPress={() => openListing(site.url(q))}
                            style={[styles.siteChip, { borderColor: t.accent }]}
                            accessibilityRole="link"
                          >
                            <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>{site.name} ↗</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  primary,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: primary ? t.accent : t.card,
          borderColor: primary ? t.accent : t.border,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={primary ? t.accentText : t.text} />
      <Text style={{ color: primary ? t.accentText : t.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  toolbarScroll: { flexGrow: 0, borderBottomWidth: 1 },
  toolbar: { flexDirection: 'row', gap: 8, padding: 10 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 19, borderWidth: 1 },
  status: { paddingHorizontal: 12, paddingTop: 8, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { position: 'absolute', left: 12, bottom: 16, maxWidth: 230, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, opacity: 0.92 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 520, borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  tallSheet: { maxHeight: '90%' },
  sheetTitle: { fontSize: 20, fontWeight: '800' },
  cluster: { borderTopWidth: 1, paddingTop: 14, gap: 10 },
  thumbs: { flexDirection: 'row', gap: 4 },
  thumb: { width: 52, height: 64, borderRadius: 6, backgroundColor: '#ddd' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  siteChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
});
