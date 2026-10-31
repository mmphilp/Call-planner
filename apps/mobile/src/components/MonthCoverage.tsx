import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, dayOfWeek } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Month grid for the group schedule: a dot marks days you're on call, a red
 * dot marks days with an uncovered shift. Tap a day to see who's on.
 */
export function MonthCoverage({
  month,
  selected,
  onSelect,
  mine,
  open,
  min,
  max,
}: {
  /** YYYY-MM */
  month: string;
  selected: string | null;
  onSelect: (date: string) => void;
  mine: Set<string>;
  open: Set<string>;
  min: string;
  max: string;
}) {
  const t = useTheme();
  const first = `${month}-01`;
  const lead = (dayOfWeek(first) + 6) % 7; // Monday-first
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.row}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={[styles.cell, styles.dow, { color: t.muted }]}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={styles.row}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={styles.cell} />;
            const outside = d < min || d > max;
            const isSel = d === selected;
            return (
              <Pressable
                key={d}
                disabled={outside}
                onPress={() => onSelect(d)}
                accessibilityLabel={d}
                accessibilityState={{ selected: isSel }}
                style={styles.cell}
              >
                <View style={[styles.num, isSel && { backgroundColor: t.accent }]}>
                  <Text style={{ color: isSel ? t.accentText : outside ? t.border : t.text, fontWeight: isSel ? '700' : '400' }}>
                    {Number(d.slice(8))}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {mine.has(d) && <View style={[styles.dot, { backgroundColor: t.accent }]} />}
                  {open.has(d) && <View style={[styles.dot, { backgroundColor: t.bad }]} />}
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
  wrap: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 8, width: '100%', maxWidth: 420, alignSelf: 'center' },
  row: { flexDirection: 'row' },
  cell: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  dow: { height: 22, lineHeight: 22, fontSize: 12 },
  num: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
