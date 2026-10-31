import { useColorScheme } from 'react-native';

const light = {
  bg: '#f4f5f8',
  card: '#ffffff',
  border: '#e1e4ea',
  text: '#141b26',
  muted: '#5f6b7c',
  // Brand: cherry red from the logo
  accent: '#90021e',
  accentText: '#ffffff',
  ok: '#047857',
  okBg: '#e3f5ec',
  warn: '#b45309',
  warnBg: '#fdf1dd',
  bad: '#b91c1c',
  badBg: '#fdeaea',
};

const dark: typeof light = {
  bg: '#0d1117',
  card: '#161c25',
  border: '#2a3340',
  text: '#e8ecf2',
  muted: '#98a3b4',
  accent: '#f07a8c',
  accentText: '#2a0009',
  ok: '#4ade80',
  okBg: '#10281c',
  warn: '#fbbf24',
  warnBg: '#2c230f',
  bad: '#f87171',
  badBg: '#2e1515',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
