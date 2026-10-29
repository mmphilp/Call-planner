import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Card, Chip, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type Period, type Schedule } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, dayOfWeek, KIND_LABEL, nowLocal, shiftSpan, shortDate, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** Monday on or before the given date. */
function mondayOf(date: string) {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export default function ScheduleScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const periods = useApi(() => api<Period[]>('GET', '/api/periods'));
  const published = useMemo(() => (periods.data ?? []).filter((p) => p.status === 'published'), [periods.data]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState(mondayOf(todayStr()));

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
        setWeek(mondayOf(anchor));
      })
      .catch((e: Error) => setError(e.message));
  }, [periodId]);

  const people = useMemo(() => new Map(schedule?.people.map((p) => [p.id, p])), [schedule]);
  const services = useMemo(() => new Map(schedule?.services.map((s) => [s.id, s])), [schedule]);
  const owner = useMemo(() => new Map(schedule?.assignments.map((a) => [a.shiftId, a.userId])), [schedule]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  // Weekend blocks also show on the Saturday and Sunday they cover.
  const shiftsByDay = new Map(
    days.map((d) => [
      d,
      schedule?.shifts.filter((s) => s.date === d || (s.kind === 'weekend' && s.date < d && s.end > `${d}T07:00`)) ?? [],
    ]),
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
              <ShiftLine key={s.id} label={`${services.get(s.serviceId)?.name} · ${KIND_LABEL[s.kind]}`} color={services.get(s.serviceId)?.color} person={people.get(owner.get(s.id) ?? '')} me={owner.get(s.id) === user?.id} />
            ))}
          </Card>
        </>
      )}

      {schedule && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <Pressable onPress={() => setWeek(addDays(week, -7))} hitSlop={12} disabled={week <= schedule.period.startDate}>
              <T bold style={{ color: t.accent, opacity: week <= schedule.period.startDate ? 0.3 : 1 }}>‹ Prev</T>
            </Pressable>
            <T bold>Week of {shortDate(week).split(', ')[1]}</T>
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
                  {shortDate(d)}
                  {d === todayStr() ? ' · Today' : ''}
                </SectionHeader>
                <Card style={{ gap: 10 }}>
                  {list.map((s) => (
                    <ShiftLine
                      key={s.id}
                      label={`${services.get(s.serviceId)?.name} · ${KIND_LABEL[s.kind]}`}
                      sub={shiftSpan(s)}
                      color={services.get(s.serviceId)?.color}
                      person={people.get(owner.get(s.id) ?? '')}
                      me={owner.get(s.id) === user?.id}
                    />
                  ))}
                </Card>
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
  me,
}: {
  label: string;
  sub?: string;
  color?: string;
  person?: { name: string; phone: string | null };
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
          {person ? person.name : 'Unassigned'}
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
