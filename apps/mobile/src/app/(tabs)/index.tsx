import { View } from 'react-native';
import { Badge, Card, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type MyShift } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KIND_LABEL, monthLabel, shiftSpan, longDate, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function MyCallScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const { data, error, refreshing, refresh } = useApi(() => api<MyShift[]>('GET', `/api/me/shifts?from=${todayStr()}`));

  const shifts = data ?? [];
  const [next, ...rest] = shifts;
  const byMonth = new Map<string, MyShift[]>();
  for (const s of rest) {
    const key = monthLabel(s.date);
    byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
  }
  const weekends = shifts.filter((s) => s.kind === 'weekend').length;

  return (
    <Screen
      title="My Call"
      subtitle={user?.name}
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <ErrorText message={error} />
      {data && !shifts.length && (
        <Empty title="No upcoming call" body="Your shifts appear here once the scheduler publishes the schedule." />
      )}
      {next && (
        <Card style={{ backgroundColor: t.accent, borderColor: t.accent }}>
          <T size={13} bold style={{ color: t.accentText, opacity: 0.85 }}>
            NEXT UP
          </T>
          <T size={24} bold style={{ color: t.accentText, marginTop: 4 }}>
            {longDate(next.date)}
          </T>
          <T size={17} style={{ color: t.accentText, marginTop: 2 }}>
            {next.serviceName} · {KIND_LABEL[next.kind]}
          </T>
          <T style={{ color: t.accentText, opacity: 0.85, marginTop: 2 }}>{shiftSpan(next)}</T>
        </Card>
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

function ShiftRow({ shift }: { shift: MyShift }) {
  const t = useTheme();
  return (
    <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: shift.color ?? t.accent }} />
      <View style={{ flex: 1, gap: 2 }}>
        <T bold>{longDate(shift.date)}</T>
        <T>
          {shift.serviceName} · {KIND_LABEL[shift.kind]}
        </T>
        <T muted size={13}>
          {shiftSpan(shift)}
        </T>
      </View>
      {shift.holiday && <Badge label={shift.holidayName ?? 'Holiday'} tone="warn" />}
    </Card>
  );
}
