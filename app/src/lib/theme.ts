import { useColorScheme } from 'react-native';

const light = {
  bg: '#f6f4f0',
  card: '#ffffff',
  text: '#1c1a17',
  muted: '#6f6a62',
  border: '#e2ddd4',
  accent: '#8a4b2a',
  accentText: '#ffffff',
  like: '#2f7d4f',
  nope: '#a23b3b',
  inputBg: '#ffffff',
};

const dark: typeof light = {
  bg: '#141311',
  card: '#1f1d1a',
  text: '#f1ede6',
  muted: '#a39d93',
  border: '#34312c',
  accent: '#d08a5c',
  accentText: '#141311',
  like: '#5dbb83',
  nope: '#e07070',
  inputBg: '#26231f',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
