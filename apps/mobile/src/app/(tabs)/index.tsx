import { Redirect, router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Badge, Card, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type MyShift } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { kindLabel, monthLabel, shiftSpan, longDate, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function MyCallScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const { data, error, refreshing, refresh } = useApi(() => api<MyShift[]>('GET', `/api/me/shifts?from=${todayStr()}`));
  // View-only accounts have no call of their own.
  if (user?.role === 'viewer') return <Redirect href="/schedule" />;

  const shifts = data ?? [];
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
      {data && !shifts.length && (
        <Empty title="No upcoming call" body="Your shifts appear here once the scheduler publishes the schedule." />
      )}
      {next && (
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
      {shifts.length > 0 && (
        <T muted>
          {shifts.length} upcoming shifts, including {weekends} weekend{weekends === 1 ? '' : 's'}
        </T>
      )}
      {[...byMonth].map(([month, items]) => (
        <View key={month} style={{ gap: 8 }}>
          <SectionHeader>{month}</SectionHeader>
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
  // Tap a shift to offer it up or propose a swap.
  return (
    <Pressable
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
      {shift.holiday && <Badge label={shift.holidayName ?? 'Holiday'} tone="warn" />}
      <T muted size={18}>›</T>
    </Card>
    </Pressable>
  );
}
