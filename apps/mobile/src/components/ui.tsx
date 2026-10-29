import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

/** Load data whenever the screen gains focus, with pull-to-refresh. */
export function useApi<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, refreshing, refresh, reload: load };
}

export function Screen({
  title,
  subtitle,
  children,
  refreshing,
  onRefresh,
  right,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  right?: ReactNode;
}) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.text }]}>{title}</Text>
            {subtitle ? <Text style={{ color: t.muted, marginTop: 2 }}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function T({
  children,
  muted,
  bold,
  size,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text style={[{ color: muted ? t.muted : t.text, fontWeight: bold ? '600' : '400', fontSize: size ?? 15 }, style]}>
      {children}
    </Text>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.muted }]}>{children}</Text>;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const t = useTheme();
  const colors = {
    ok: [t.okBg, t.ok],
    warn: [t.warnBg, t.warn],
    bad: [t.badBg, t.bad],
    neutral: [t.bg, t.muted],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors[0] }]}>
      <Text style={{ color: colors[1], fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? t.accent : t.card,
          borderColor: primary ? t.accent : t.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? t.accentText : t.text} />
      ) : (
        <Text style={{ color: primary ? t.accentText : variant === 'danger' ? t.bad : t.text, fontWeight: '600', fontSize: 16 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? t.accent : t.card, borderColor: selected ? t.accent : t.border }]}
    >
      <Text style={{ color: selected ? t.accentText : t.text, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View style={[styles.error, { backgroundColor: t.badBg }]}>
      <Text style={{ color: t.bad }}>{message}</Text>
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <T bold>{title}</T>
      {body ? (
        <T muted style={{ textAlign: 'center', marginTop: 6 }}>
          {body}
        </T>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 48, gap: 12 },
  // On web the tab bar floats over the top of the page.
  header: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4, marginTop: Platform.OS === 'web' ? 72 : 8 },
  title: { fontSize: 30, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  button: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  error: { borderRadius: 10, padding: 12 },
});
