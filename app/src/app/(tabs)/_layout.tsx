import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { useTheme } from '../../lib/theme';

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.bg },
        headerTitleStyle: { color: t.text },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Shop', tabBarIcon: ({ color, size }) => <Ionicons name="pricetags-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="board"
        options={{ title: 'Moodboard', tabBarIcon: ({ color, size }) => <Ionicons name="images-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="saved"
        options={{ title: 'Saved', tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="setup"
        options={{ title: 'Setup', tabBarIcon: ({ color, size }) => <Ionicons name="options-outline" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
