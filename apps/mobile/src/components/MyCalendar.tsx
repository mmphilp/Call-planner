import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MyShift } from '@/lib/api';
import { addDays, dayOfWeek, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** Your shifts that touch a day: that day's day/night call, or a weekend or holiday block covering it. */
export function shiftsOnDay(shifts: MyShift[], d: string) {
  return shifts.filter((s) => (s.kind === 'weekend' ? s.start.slice(0, 10) <= d && s.end > `${d}T07:00` : s.date === d));
}

const KIND_LETTER = { day: 'D', night: 'N', weekend: 'W' } as const;

/**
 * Month grid of your own call. Each shift on a day shows as a small bar in
 * its service's colour, marked D (day), N (night) or W (weekend/holiday
 * block); proposed shifts are outlined rather than filled. Tap a day to list it.
 */
export function MyCalendar({
  month,
  shifts,
  selected,
  onSelect,
  holidays,
}: {
  /** YYYY-MM */
  month: string;
  shifts: MyShift[];
  selected: string | null;
  onSelect: (date: string) => void;
  /** Holiday names by date. */
  holidays: Map<string, string>;
}) {
  const t = useTheme();
  const today = todayStr();
  const first = `${month}-01`;
  const cells: (string | null)[] = Array(dayOfWeek(first)).fill(null); // Sunday-first
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.row}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <Text key={i} style={[styles.dow, { color: t.muted }]}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={styles.row}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={styles.cell} />;
            const mine = shiftsOnDay(shifts, d);
            const isSel = d === selected;
            const past = d < today;
            return (
              <Pressable
                key={d}
                onPress={() => onSelect(d)}
                accessibilityLabel={`${d}${mine.length ? `, ${mine.length} shift${mine.length > 1 ? 's' : ''}` : ''}${holidays.has(d) ? `, ${holidays.get(d)}` : ''}`}
                accessibilityState={{ selected: isSel }}
                style={[styles.cell, isSel && { backgroundColor: t.bg, borderRadius: 10 }]}
              >
                <View
                  style={[
                    styles.num,
                    d === today && { borderWidth: 1.5, borderColor: t.accent },
                    isSel && { backgroundColor: t.accent, borderColor: t.accent },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: isSel ? t.accentText : holidays.has(d) ? t.warn : t.text,
                      opacity: past && !isSel ? 0.45 : 1,
                      fontWeight: isSel || mine.length ? '700' : '400',
                    }}
                  >
                    {Number(d.slice(8))}
                  </Text>
                </View>
                <View style={styles.bars}>
                  {mine.slice(0, 3).map((s) => {
                    const color = s.color ?? t.accent;
                    return (
                      <View
                        key={s.id}
                        style={[
                          styles.bar,
                          s.proposed ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color },
                          past && { opacity: 0.45 },
                        ]}
                      >
                        <Text style={[styles.letter, { color: s.proposed ? color : '#fff' }]}>{KIND_LETTER[s.kind]}</Text>
                      </View>
                    );
                  })}
                </View>
                {holidays.has(d) && <Text style={[styles.star, { color: t.warn }]}>★</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 6, width: '100%', maxWidth: 480, alignSelf: 'center' },
  row: { flexDirection: 'row' },
  dow: { flex: 1, textAlign: 'center', fontSize: 12, height: 22, lineHeight: 22 },
  cell: { flex: 1, height: 66, alignItems: 'center', paddingTop: 4 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bars: { flexDirection: 'row', gap: 2, marginTop: 4 },
  bar: { minWidth: 14, height: 14, borderRadius: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  letter: { fontSize: 9, fontWeight: '800', lineHeight: 11 },
  star: { position: 'absolute', top: 2, right: 4, fontSize: 9 },
});
