import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { MyCalendar, shiftsOnDay } from '@/components/MyCalendar';
import { Badge, Card, Chip, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type MyShift, type Period } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { holidayMap, kindLabel, monthLabel, nowLocal, shiftSpan, longDate, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** YYYY-MM, moved by whole months. */
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default function MyCallScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const thisMonth = todayStr().slice(0, 7);
  // All your shifts, past and future, so the calendar and Past list can go back in time.
  const { data, error, refreshing, refresh } = useApi(async () => {
    const [shifts, periods] = await Promise.all([
      api<MyShift[]>('GET', '/api/me/shifts'),
      api<Period[]>('GET', '/api/periods'),
    ]);
    return { shifts, periods };
  });
  const [mode, setMode] = useState<'list' | 'past' | 'calendar'>('list');
  const [month, setMonth] = useState(thisMonth);
  const [day, setDay] = useState<string | null>(todayStr());
  const holidays = useMemo(() => holidayMap(data?.periods.flatMap((p) => p.calendarHolidays ?? [])), [data]);
  // View-only accounts have no call of their own.
  if (user?.role === 'viewer') return <Redirect href="/schedule" />;

  const all = data?.shifts ?? [];
  const shifts = all.filter((s) => s.end >= todayStr());
  // Past shifts, most recent first, by month.
  const past = all.filter((s) => s.end < todayStr()).reverse();
  const pastByMonth = new Map<string, MyShift[]>();
  for (const s of past) pastByMonth.set(monthLabel(s.date), [...(pastByMonth.get(monthLabel(s.date)) ?? []), s]);
  const months = [...all.flatMap((s) => [s.start.slice(0, 7), s.end.slice(0, 7)]), thisMonth].sort();
  const firstMonth = months[0];
  const lastMonth = months.at(-1)!;
  const [next, ...rest] = shifts;
  const byMonth = new Map<string, MyShift[]>();
  for (const s of rest) {
    const key = monthLabel(s.date);
    byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
  }
  const weekends = shifts.filter((s) => s.kind === 'weekend').length;
  const proposed = shifts.some((s) => s.proposed);

  return (
    <Screen
      title="My Call"
      subtitle={user?.name}
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <ErrorText message={error} />
      {proposed && (
        <Card style={{ gap: 4, borderColor: t.warn }}>
          <T bold>Proposed schedule — please check it</T>
          <T muted size={13}>
            Shifts marked Proposed aren’t final yet. If one looks wrong, tap it to flag it for the scheduler. Anything in the group
            schedule can be flagged from the Schedule tab.
          </T>
        </Card>
      )}
      {data && mode === 'list' && !shifts.length && (
        <Empty title="No upcoming call" body="Your shifts appear here once the scheduler publishes the schedule." />
      )}
      {all.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Upcoming" selected={mode === 'list'} onPress={() => setMode('list')} />
          <Chip label="Past" selected={mode === 'past'} onPress={() => setMode('past')} />
          <Chip label="Calendar" selected={mode === 'calendar'} onPress={() => setMode('calendar')} />
        </View>
      )}
      {mode === 'calendar' && all.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12} disabled={month <= firstMonth}>
              <T bold style={{ color: t.accent, opacity: month <= firstMonth ? 0.3 : 1 }}>‹ Prev</T>
            </Pressable>
            <T bold>{monthLabel(`${month}-01`)}</T>
            <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12} disabled={month >= lastMonth}>
              <T bold style={{ color: t.accent, opacity: month >= lastMonth ? 0.3 : 1 }}>Next ›</T>
            </Pressable>
          </View>
          <MyCalendar month={month} shifts={all} selected={day} onSelect={setDay} holidays={holidays} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            <T muted size={12}>D day · N night · W weekend/holiday</T>
            {all.some((s) => s.proposed) && <T muted size={12}>Outlined = proposed</T>}
            {[...holidays.keys()].some((d) => d.startsWith(month)) && (
              <T muted size={12}><T size={12} style={{ color: t.warn }}>★</T> Holiday</T>
            )}
          </View>
          {day && day.startsWith(month) && (
            <View style={{ gap: 8 }}>
              <SectionHeader>
                {longDate(day)}
                {day === todayStr() ? ' · Today' : ''}
                {holidays.has(day) ? ` · ★ ${holidays.get(day)}` : ''}
              </SectionHeader>
              {shiftsOnDay(all, day).length ? (
                shiftsOnDay(all, day).map((s) => <ShiftRow key={s.id} shift={s} />)
              ) : (
                <Card><T muted>You’re not on call.</T></Card>
              )}
            </View>
          )}
        </>
      )}
      {mode === 'list' && next && (
        <Pressable accessibilityRole="button" onPress={() => openShift(next)}>
        <Card style={{ backgroundColor: t.accent, borderColor: t.accent }}>
          <T size={13} bold style={{ color: t.accentText, opacity: 0.85 }}>
            {next.proposed ? 'NEXT UP · PROPOSED' : 'NEXT UP'}
          </T>
          <T size={24} bold style={{ color: t.accentText, marginTop: 4 }}>
            {longDate(next.date)}
          </T>
          <T size={17} style={{ color: t.accentText, marginTop: 2 }}>
            {next.serviceName} · {kindLabel(next)}
          </T>
          <T style={{ color: t.accentText, opacity: 0.85, marginTop: 2 }}>{shiftSpan(next)}</T>
        </Card>
        </Pressable>
      )}
      {mode === 'list' && shifts.length > 0 && (
        <T muted>
          {shifts.length} upcoming shifts, including {weekends} weekend{weekends === 1 ? '' : 's'}
        </T>
      )}
      {mode === 'list' && [...byMonth].map(([month, items]) => (
        <View key={month} style={{ gap: 8 }}>
          <SectionHeader>{month}</SectionHeader>
          {items.map((s) => (
            <ShiftRow key={s.id} shift={s} />
          ))}
        </View>
      ))}
      {mode === 'past' && !past.length && <Empty title="No past call yet" body="Shifts you’ve covered will show here." />}
      {mode === 'past' && past.length > 0 && (
        <T muted>
          {past.length} past shift{past.length === 1 ? '' : 's'}, including {past.filter((s) => s.kind === 'weekend').length} weekend
          {past.filter((s) => s.kind === 'weekend').length === 1 ? '' : 's'}
        </T>
      )}
      {mode === 'past' &&
        [...pastByMonth].map(([label, items]) => (
          <View key={label} style={{ gap: 8 }}>
            <SectionHeader>{label}</SectionHeader>
            {items.map((s) => (
              <ShiftRow key={s.id} shift={s} />
            ))}
          </View>
        ))}
    </Screen>
  );
}

/** Proposed shifts can be flagged; published ones swapped or given away. */
function openShift(shift: MyShift) {
  router.push({ pathname: shift.proposed ? '/flag' : '/trade', params: { shiftId: shift.id, periodId: shift.periodId } });
}

function ShiftRow({ shift }: { shift: MyShift }) {
  const t = useTheme();
  // Tap a shift to offer it up or propose a swap (not once it's over).
  const over = shift.end <= nowLocal();
  return (
    <Pressable
      disabled={over}
      accessibilityRole="button"
      accessibilityHint={shift.proposed ? 'Flag a problem with this shift' : 'Swap or give away this shift'}
      onPress={() => openShift(shift)}
    >
    <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: shift.color ?? t.accent }} />
      <View style={{ flex: 1, gap: 2 }}>
        <T bold>{longDate(shift.date)}</T>
        <T>
          {shift.serviceName} · {kindLabel(shift)}
        </T>
        <T muted size={13}>
          {shiftSpan(shift)}
        </T>
      </View>
      {shift.proposed && <Badge label="Proposed" />}
      {shift.changed && <Badge label="Updated" tone="ok" />}
      {shift.holiday && <Badge label={shift.holidayName ?? 'Holiday'} tone="warn" />}
      {!over && <T muted size={18}>›</T>}
    </Card>
    </Pressable>
  );
}
