import { useColorScheme } from 'react-native';

/**
 * Single source of truth for colors + spacing.
 * Add a key here and it becomes available everywhere via `useTheme()`.
 */
const palette = {
  light: {
    background: '#F6F7F9',
    card: '#FFFFFF',
    text: '#0B1220',
    textMuted: '#6B7280',
    border: '#E5E7EB',
    accent: '#2563EB',
    danger: '#DC2626',
    success: '#059669',
    warning: '#B45309',
  },
  dark: {
    background: '#0B1220',
    card: '#151C2C',
    text: '#F3F4F6',
    textMuted: '#9CA3AF',
    border: '#24304A',
    accent: '#60A5FA',
    danger: '#F87171',
    success: '#34D399',
    warning: '#FBBF24',
  },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export type Colors = typeof palette.light;

export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? palette.dark : palette.light;
  return { colors, scheme: scheme ?? 'light', spacing, radius };
}
