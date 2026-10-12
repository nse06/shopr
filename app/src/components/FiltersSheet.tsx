import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Prefs } from '../lib/api';
import { useTheme } from '../lib/theme';
import { Button, Field, Muted } from './ui';

const TOPS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const WAIST = ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40'];
const SHOES = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'];
const PRICE_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Under $50', min: null, max: 50 },
  { label: '$50–150', min: 50, max: 150 },
  { label: '$150–300', min: 150, max: 300 },
  { label: 'Any price', min: null, max: null },
];

export type Filters = Pick<Prefs, 'sizes_tops' | 'sizes_waist' | 'sizes_shoes' | 'min_price' | 'max_price'>;

export function filtersSummary(p: Filters): string {
  const sizes = [...p.sizes_tops, ...p.sizes_waist.map((w) => `${w}W`), ...p.sizes_shoes.map((s) => `US ${s}`)];
  const price =
    p.min_price != null && p.max_price != null
      ? `$${p.min_price}–${p.max_price}`
      : p.max_price != null
        ? `under $${p.max_price}`
        : p.min_price != null
          ? `$${p.min_price}+`
          : 'any price';
  return `${sizes.length ? sizes.join(', ') : 'Any size'} · ${price}`;
}

/** Asks for sizes and a price range; shown before the first search and from "Edit". */
export function FiltersSheet({
  visible,
  initial,
  firstTime,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: Filters;
  firstTime: boolean;
  onSave: (f: Filters) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [tops, setTops] = useState(initial.sizes_tops);
  const [waist, setWaist] = useState(initial.sizes_waist);
  const [shoes, setShoes] = useState(initial.sizes_shoes);
  const [min, setMin] = useState(initial.min_price?.toString() ?? '');
  const [max, setMax] = useState(initial.max_price?.toString() ?? '');

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const save = () =>
    onSave({
      sizes_tops: tops,
      sizes_waist: waist,
      sizes_shoes: shoes,
      min_price: min.trim() ? Number(min) : null,
      max_price: max.trim() ? Number(max) : null,
    });

  const chips = (label: string, values: string[], picked: string[], set: (v: string[]) => void) => (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: t.text }]}>{label}</Text>
      <View style={styles.chips}>
        {values.map((v) => {
          const on = picked.includes(v);
          return (
            <Pressable
              key={v}
              onPress={() => toggle(picked, set, v)}
              style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : 'transparent' }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Text style={{ color: on ? t.accentText : t.text, fontWeight: '600' }}>{v}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: t.bg, borderColor: t.border }]}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, { color: t.text }]}>{firstTime ? 'What are you shopping for?' : 'Sizes & price'}</Text>
            <Muted>
              shopr only shows listings in your sizes and price range. Pick all the sizes that fit you; leave a row empty
              to skip it.
            </Muted>
            {chips('Tops & jackets', TOPS, tops, setTops)}
            {chips('Pants (waist)', WAIST, waist, setWaist)}
            {chips('Shoes (US)', SHOES, shoes, setShoes)}
            <View style={styles.group}>
              <Text style={[styles.groupLabel, { color: t.text }]}>Price range (US$)</Text>
              <View style={styles.chips}>
                {PRICE_PRESETS.map((p) => (
                  <Pressable
                    key={p.label}
                    onPress={() => {
                      setMin(p.min?.toString() ?? '');
                      setMax(p.max?.toString() ?? '');
                    }}
                    style={[styles.chip, { borderColor: t.border }]}
                  >
                    <Text style={{ color: t.text }}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.row}>
                <Field value={min} onChangeText={setMin} placeholder="Min $" inputMode="numeric" style={{ flex: 1 }} />
                <Text style={{ color: t.muted }}>to</Text>
                <Field value={max} onChangeText={setMax} placeholder="Max $" inputMode="numeric" style={{ flex: 1 }} />
              </View>
            </View>
            <Muted style={{ fontSize: 13 }}>Listings that don&apos;t say their size are still shown.</Muted>
            <View style={styles.row}>
              {!firstTime && <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />}
              <Button title={firstTime ? 'Start searching' : 'Save and search'} onPress={save} style={{ flex: 2 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '92%', borderRadius: 16, borderWidth: 1 },
  title: { fontSize: 22, fontWeight: '800' },
  group: { gap: 8 },
  groupLabel: { fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 44, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
