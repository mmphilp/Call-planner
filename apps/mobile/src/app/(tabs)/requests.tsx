import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Badge, Button, Card, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type CallRequest, type Period } from '@/lib/api';
import { confirmAsync, notify } from '@/lib/dialogs';
import { dateRange, longDate, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export const TYPE_LABEL: Record<CallRequest['type'], string> = {
  unavailable: 'Unavailable',
  prefer_off: 'Prefer off',
  prefer_on: 'Would like call',
};

const STATUS_TONE = { pending: 'warn', approved: 'ok', denied: 'bad' } as const;
const KINDS = { day: 'days', night: 'nights', weekend: 'weekends' } as const;

export function acceptingRequests(p: Period) {
  return p.status === 'open' && (!p.requestDeadline || todayStr() <= p.requestDeadline);
}

export default function RequestsScreen() {
  const t = useTheme();
  const { data, error, refreshing, refresh, reload } = useApi(async () => {
    const [periods, requests] = await Promise.all([
      api<Period[]>('GET', '/api/periods'),
      api<CallRequest[]>('GET', '/api/requests'),
    ]);
    return { periods, requests };
  });

  const open = data?.periods.filter(acceptingRequests) ?? [];

  const withdraw = async (r: CallRequest) => {
    if (!(await confirmAsync('Withdraw request?', `${TYPE_LABEL[r.type]}: ${dateRange(r.startDate, r.endDate)}`, 'Withdraw', true))) return;
    try {
      await api('DELETE', `/api/requests/${r.id}`);
      reload();
    } catch (e) {
      notify('Could not withdraw', (e as Error).message);
    }
  };

  return (
    <Screen title="Requests" subtitle="Time off and call preferences" refreshing={refreshing} onRefresh={refresh}>
      <ErrorText message={error} />
      {open.map((p) => (
        <Card key={p.id} style={{ gap: 10 }}>
          <T bold size={17}>{p.label} is taking requests</T>
          {p.requestDeadline && <T muted>Send requests by {longDate(p.requestDeadline)}.</T>}
          <Button label="New request" onPress={() => router.push({ pathname: '/new-request', params: { periodId: p.id } })} />
        </Card>
      ))}
      {data && !open.length && (
        <Card>
          <T muted>No schedule is taking requests right now. Your scheduler will let you know when the next half-year opens.</T>
        </Card>
      )}

      {data?.periods.map((p) => {
        const mine = data.requests.filter((r) => r.periodId === p.id);
        if (!mine.length) return null;
        return (
          <View key={p.id} style={{ gap: 8 }}>
            <SectionHeader>{p.label}</SectionHeader>
            {mine.map((r) => (
              <Card key={r.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <T bold>{TYPE_LABEL[r.type]}</T>
                  <Badge label={r.status[0].toUpperCase() + r.status.slice(1)} tone={STATUS_TONE[r.status]} />
                </View>
                <T>{dateRange(r.startDate, r.endDate)}</T>
                {r.shiftKinds.length > 0 && <T muted size={13}>Only {r.shiftKinds.map((k) => KINDS[k]).join(' and ')}</T>}
                {r.note ? <T muted size={13}>“{r.note}”</T> : null}
                {r.adminNote ? <T size={13}>Scheduler: {r.adminNote}</T> : null}
                {r.status === 'pending' && acceptingRequests(p) && (
                  <Pressable onPress={() => withdraw(r)} hitSlop={8} style={{ marginTop: 4 }}>
                    <T style={{ color: t.bad }}>Withdraw</T>
                  </Pressable>
                )}
              </Card>
            ))}
          </View>
        );
      })}
      {data && !data.requests.length && open.length > 0 && (
        <Empty title="No requests yet" body="Ask for vacation, conferences or weekends you’d like off — or call you’d like to pick up." />
      )}
    </Screen>
  );
}
