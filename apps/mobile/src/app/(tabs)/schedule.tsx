import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { MonthCoverage } from '@/components/MonthCoverage';
import { Card, Chip, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type Period, type Schedule } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, dayOfWeek, holidayMap, kindLabel, longDate, monthDay, monthLabel, nowLocal, shiftSpan, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Shifts to list under a day: that day's shifts, plus a weekend block on each
 * day it covers. Services alphabetically; weekend blocks last (on Fridays they
 * start at 5pm, after the day's team call).
 */
function shiftsOn(schedule: Schedule | null, d: string) {
  if (!schedule) return [];
  const name = new Map(schedule.services.map((s) => [s.id, s.name]));
  const order = { day: 0, night: 1, weekend: 2 } as const;
  return schedule.shifts
    // A weekend or holiday block shows on every day it covers, from the evening it starts.
    .filter((s) => (s.kind === 'weekend' ? s.start.slice(0, 10) <= d && s.end > `${d}T07:00` : s.date === d))
    .sort(
      (a, b) =>
        Number(a.kind === 'weekend') - Number(b.kind === 'weekend') ||
        (name.get(a.serviceId) ?? '').localeCompare(name.get(b.serviceId) ?? '') ||
        order[a.kind] - order[b.kind],
    );
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Sunday on or before the given date (weeks run Sunday–Saturday). */
function weekOf(date: string) {
  return addDays(date, -dayOfWeek(date));
}

export default function ScheduleScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const periods = useApi(() => api<Period[]>('GET', '/api/periods'));
  const published = useMemo(() => (periods.data ?? []).filter((p) => p.status === 'published'), [periods.data]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState(weekOf(todayStr()));
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [day, setDay] = useState<string | null>(todayStr());

  // Default to the period that contains today, else the latest published one.
  useEffect(() => {
    if (periodId || !published.length) return;
    const today = todayStr();
    setPeriodId((published.find((p) => p.startDate <= today && today <= p.endDate) ?? published[0]).id);
  }, [published, periodId]);

  useEffect(() => {
    if (!periodId) return;
    api<Schedule>('GET', `/api/periods/${periodId}/schedule`)
      .then((s) => {
        setSchedule(s);
        setError(null);
        const today = todayStr();
        const anchor = today >= s.period.startDate && today <= s.period.endDate ? today : s.period.startDate;
        setWeek(weekOf(anchor));
        setMonth(anchor.slice(0, 7));
        setDay(anchor);
      })
      .catch((e: Error) => setError(e.message));
  }, [periodId]);

  const people = useMemo(() => new Map(schedule?.people.map((p) => [p.id, p])), [schedule]);
  const services = useMemo(() => new Map(schedule?.services.map((s) => [s.id, s])), [schedule]);
  const owner = useMemo(() => new Map(schedule?.assignments.map((a) => [a.shiftId, a.userId])), [schedule]);

  const holidays = useMemo(() => holidayMap(schedule?.period.calendarHolidays), [schedule]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  // Weekend blocks also show on the Saturday and Sunday they cover.
  const shiftsByDay = new Map(days.map((d) => [d, shiftsOn(schedule, d)]));

  // For the month grid: days I'm on call, and days with an uncovered shift.
  const { mine, open } = useMemo(() => {
    const mine = new Set<string>();
    const open = new Set<string>();
    if (!schedule) return { mine, open };
    const first = `${month}-01`;
    for (let d = first; d.startsWith(month); d = addDays(d, 1)) {
      for (const s of shiftsOn(schedule, d)) {
        if (owner.get(s.id) === user?.id) mine.add(d);
        else if (!owner.get(s.id) && !s.coveredBy) open.add(d);
      }
    }
    return { mine, open };
  }, [schedule, month, owner, user?.id]);

  const line = (s: Schedule['shifts'][number], withTimes = true) => (
    <ShiftLine
      key={s.id}
      label={`${services.get(s.serviceId)?.name} · ${kindLabel(s)}`}
      sub={withTimes ? shiftSpan(s) : undefined}
      color={services.get(s.serviceId)?.color}
      person={people.get(owner.get(s.id) ?? '')}
      locum={s.coveredBy}
      me={owner.get(s.id) === user?.id}
    />
  );
  const now = nowLocal();
  const onNow = (schedule?.shifts ?? []).filter((s) => s.start <= now && now < s.end);

  return (
    <Screen title="Schedule" subtitle="Who’s on call" refreshing={periods.refreshing} onRefresh={periods.refresh}>
      <ErrorText message={periods.error ?? error} />
      {periods.data && !published.length && (
        <Empty title="No published schedule yet" body="You’ll see the full group schedule here once it’s published." />
      )}
      {published.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {published.map((p) => (
            <Chip key={p.id} label={p.label} selected={p.id === periodId} onPress={() => setPeriodId(p.id)} />
          ))}
        </ScrollView>
      )}

      {schedule && onNow.length > 0 && (
        <>
          <SectionHeader>On call now</SectionHeader>
          <Card style={{ gap: 10 }}>
            {onNow.map((s) => (
              <ShiftLine key={s.id} label={`${services.get(s.serviceId)?.name} · ${kindLabel(s)}`} color={services.get(s.serviceId)?.color} person={people.get(owner.get(s.id) ?? '')}
                      locum={s.coveredBy} me={owner.get(s.id) === user?.id} />
            ))}
          </Card>
        </>
      )}

      {schedule && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Chip label="Week" selected={mode === 'week'} onPress={() => setMode('week')} />
          <Chip label="Month" selected={mode === 'month'} onPress={() => setMode('month')} />
        </View>
      )}

      {schedule && mode === 'month' && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12} disabled={month <= schedule.period.startDate.slice(0, 7)}>
              <T bold style={{ color: t.accent, opacity: month <= schedule.period.startDate.slice(0, 7) ? 0.3 : 1 }}>‹ Prev</T>
            </Pressable>
            <T bold>{monthLabel(`${month}-01`)}</T>
            <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12} disabled={month >= schedule.period.endDate.slice(0, 7)}>
              <T bold style={{ color: t.accent, opacity: month >= schedule.period.endDate.slice(0, 7) ? 0.3 : 1 }}>Next ›</T>
            </Pressable>
          </View>
          <MonthCoverage
            month={month}
            selected={day}
            onSelect={setDay}
            mine={mine}
            open={open}
            min={schedule.period.startDate}
            max={schedule.period.endDate}
            holidays={holidays}
          />
          <View style={{ flexDirection: 'row', gap: 14, justifyContent: 'center' }}>
            <T muted size={12}><T size={12} style={{ color: t.accent }}>●</T> You’re on call</T>
            {open.size > 0 && <T muted size={12}><T size={12} style={{ color: t.bad }}>●</T> Uncovered</T>}
            {[...holidays.keys()].some((d) => d.startsWith(month)) && (
              <T muted size={12}><T size={12} style={{ color: t.warn }}>★</T> Holiday</T>
            )}
          </View>
          {day && day.startsWith(month) && (
            <View style={{ gap: 6 }}>
              <SectionHeader>
                {longDate(day)}
                {day === todayStr() ? ' · Today' : ''}
                {holidays.has(day) ? ` · ★ ${holidays.get(day)}` : ''}
              </SectionHeader>
              <Card style={{ gap: 10 }}>
                {shiftsOn(schedule, day).length ? shiftsOn(schedule, day).map((s) => line(s)) : <T muted>No call scheduled.</T>}
              </Card>
            </View>
          )}
        </>
      )}

      {schedule && mode === 'week' && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => setWeek(addDays(week, -7))} hitSlop={12} disabled={week <= schedule.period.startDate}>
              <T bold style={{ color: t.accent, opacity: week <= schedule.period.startDate ? 0.3 : 1 }}>‹ Prev</T>
            </Pressable>
            <T bold>Week of {monthDay(week)}</T>
            <Pressable onPress={() => setWeek(addDays(week, 7))} hitSlop={12} disabled={addDays(week, 7) > schedule.period.endDate}>
              <T bold style={{ color: t.accent, opacity: addDays(week, 7) > schedule.period.endDate ? 0.3 : 1 }}>Next ›</T>
            </Pressable>
          </View>
          {days.map((d) => {
            const list = shiftsByDay.get(d) ?? [];
            if (!list.length) return null;
            return (
              <View key={d} style={{ gap: 6 }}>
                <SectionHeader>
                  {longDate(d)}
                  {d === todayStr() ? ' · Today' : ''}
                  {holidays.has(d) ? ` · ★ ${holidays.get(d)}` : ''}
                </SectionHeader>
                <Card style={{ gap: 10 }}>{list.map((s) => line(s))}</Card>
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}

function ShiftLine({
  label,
  sub,
  color,
  person,
  locum,
  me,
}: {
  label: string;
  sub?: string;
  color?: string;
  person?: { name: string; phone: string | null };
  locum?: string;
  me: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color ?? t.accent }} />
      <View style={{ flex: 1 }}>
        <T size={13} muted>
          {label}
          {sub ? ` · ${sub}` : ''}
        </T>
        <T bold style={me ? { color: t.accent } : undefined}>
          {locum ? `${locum} (locum)` : person ? person.name : 'Unassigned'}
          {me ? ' (you)' : ''}
        </T>
      </View>
      {person?.phone && !me ? (
        <Pressable onPress={() => Linking.openURL(`tel:${person.phone}`)} hitSlop={8} accessibilityLabel={`Call ${person.name}`}>
          <T bold style={{ color: t.accent }}>Call</T>
        </Pressable>
      ) : null}
    </View>
  );
}
