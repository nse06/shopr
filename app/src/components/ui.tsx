import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { useTheme } from '../lib/theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'like' | 'nope';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = { primary: t.accent, secondary: 'transparent', like: t.like, nope: t.nope }[variant];
  const fg = variant === 'secondary' ? t.text : variant === 'primary' ? t.accentText : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? t.border : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }, props.style]}
    />
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: t.text }]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: t.muted, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}

export function ErrorText({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return <Text style={{ color: t.nope, fontSize: 14, marginVertical: 6 }}>{message}</Text>;
}

export function Chip({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.chip, { borderColor: t.border }]}>
      <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  // minWidth 0 lets inputs shrink inside rows (web inputs have an intrinsic width).
  input: { minHeight: 44, minWidth: 0, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  section: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 14, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
