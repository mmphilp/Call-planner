import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, dayOfWeek, monthLabel } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Month calendar. Range mode: tap a start date, then an end date.
 * Day mode (pass `days`): tap any days on and off.
 */
export function RangeCalendar({
  min,
  max,
  start = null,
  end = null,
  onChange,
  days,
  onToggleDay,
}: {
  min: string;
  max: string;
  start?: string | null;
  end?: string | null;
  onChange?: (start: string | null, end: string | null) => void;
  days?: Set<string>;
  onToggleDay?: (date: string) => void;
}) {
  const t = useTheme();
  const [month, setMonth] = useState((start ?? [...(days ?? [])].sort()[0] ?? min).slice(0, 7));

  const first = `${month}-01`;
  const lead = dayOfWeek(first); // Sunday-first grid
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
    if (next >= min.slice(0, 7) && next <= max.slice(0, 7)) setMonth(next);
  };

  const tap = (d: string) => {
    if (days) return onToggleDay?.(d);
    if (!start || end || d < start) onChange?.(d, null);
    else onChange?.(start, d);
  };

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.head}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} accessibilityLabel="Previous month">
          <Text style={[styles.nav, { color: t.accent }]}>‹</Text>
        </Pressable>
        <Text style={{ color: t.text, fontWeight: '600', fontSize: 16 }}>{monthLabel(first)}</Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={12} accessibilityLabel="Next month">
          <Text style={[styles.nav, { color: t.accent }]}>›</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <Text key={i} style={[styles.cell, styles.dow, { color: t.muted }]}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={styles.row}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={styles.cell} />;
            const disabled = d < min || d > max;
            const isEnd = days ? days.has(d) : d === start || d === end;
            const inRange = !days && start && end && d > start && d < end;
            return (
              <Pressable
                key={d}
                disabled={disabled}
                onPress={() => tap(d)}
                accessibilityLabel={d}
                style={[styles.cell, styles.day, inRange && { backgroundColor: t.bg }]}
              >
                <View style={[styles.dot, isEnd && { backgroundColor: t.accent }]}>
                  <Text style={{ color: isEnd ? t.accentText : disabled ? t.border : t.text, fontWeight: isEnd ? '700' : '400' }}>
                    {Number(d.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed-size cells keep the calendar compact on wide screens (iPad, desktop).
  wrap: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, width: '100%', maxWidth: 360, alignSelf: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 6 },
  nav: { fontSize: 26, lineHeight: 28, paddingHorizontal: 8 },
  row: { flexDirection: 'row' },
  cell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  dow: { height: 24, lineHeight: 24, fontSize: 12 },
  day: { marginVertical: 1 },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
