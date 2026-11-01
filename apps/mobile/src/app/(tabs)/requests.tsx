import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Badge, Button, Card, Empty, ErrorText, Screen, SectionHeader, T, useApi } from '@/components/ui';
import { api, type CallRequest, type Period, type Trade } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmAsync, notify } from '@/lib/dialogs';
import { dateRange, kindLabel, longDate, todayStr } from '@/lib/format';
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
    const [periods, requests, trades] = await Promise.all([
      api<Period[]>('GET', '/api/periods'),
      api<CallRequest[]>('GET', '/api/requests'),
      api<Trade[]>('GET', '/api/trades'),
    ]);
    return { periods, requests, trades };
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
    <Screen title="Requests" subtitle="Time off, call preferences and swaps" refreshing={refreshing} onRefresh={refresh}>
      <ErrorText message={error} />
      {data && <Swaps trades={data.trades} reload={reload} />}
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

const TRADE_STATUS: Record<Trade['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  open: { label: 'Offered', tone: 'neutral' },
  proposed: { label: 'Awaiting colleague', tone: 'neutral' },
  accepted: { label: 'Awaiting approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  declined: { label: 'Declined', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

const shiftText = (s?: Trade['shift']) => (s ? `${s.serviceName} ${kindLabel(s).toLowerCase()}, ${longDate(s.date)}` : 'a removed shift');

/** Offers colleagues can take, swaps waiting on you, and your own trades. */
function Swaps({ trades, reload }: { trades: Trade[]; reload: () => void }) {
  const { user } = useAuth();
  const t = useTheme();
  const mine = user?.id;
  const offers = trades.filter((x) => x.kind === 'offer' && x.status === 'open' && x.from.id !== mine);
  const forMe = trades.filter((x) => x.kind === 'swap' && x.status === 'proposed' && x.to?.id === mine);
  const own = trades.filter((x) => (x.from.id === mine || x.to?.id === mine) && !forMe.includes(x));

  const act = async (x: Trade, action: 'take' | 'accept' | 'decline' | 'cancel', question?: string) => {
    if (question && !(await confirmAsync(question, shiftText(x.shift), action === 'take' ? 'Take it' : action[0].toUpperCase() + action.slice(1), action !== 'take' && action !== 'accept'))) return;
    try {
      await api('POST', `/api/trades/${x.id}/${action}`, {});
      if (action === 'take' || action === 'accept') notify('Done', 'It now goes to the admin to approve. Your schedule changes once it’s approved.');
      reload();
    } catch (e) {
      notify('Could not do that', (e as Error).message);
    }
  };

  if (!offers.length && !forMe.length && !own.length) {
    return (
      <Card>
        <T muted>To give away or swap a shift, tap it on My Call.</T>
      </Card>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {forMe.length > 0 && <SectionHeader>Swap requests for you</SectionHeader>}
      {forMe.map((x) => (
        <Card key={x.id} style={{ gap: 6 }}>
          <T>
            <T bold>{x.from.name}</T> would take your {shiftText(x.theirShift)} in exchange for their {shiftText(x.shift)}.
          </T>
          {x.note ? <T muted size={13}>“{x.note}”</T> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="Accept" onPress={() => act(x, 'accept', 'Accept this swap?')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Decline" variant="secondary" onPress={() => act(x, 'decline', 'Decline this swap?')} />
            </View>
          </View>
        </Card>
      ))}

      {offers.length > 0 && <SectionHeader>Shifts you can cover</SectionHeader>}
      {offers.map((x) => (
        <Card key={x.id} style={{ gap: 6 }}>
          <T>
            <T bold>{x.from.name}</T> is offering {shiftText(x.shift)}.
          </T>
          {x.note ? <T muted size={13}>“{x.note}”</T> : null}
          <Button label="Take it" onPress={() => act(x, 'take', 'Take this shift?')} />
        </Card>
      ))}

      {own.length > 0 && <SectionHeader>Your swaps and offers</SectionHeader>}
      {own.map((x) => (
        <Card key={x.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <T bold style={{ flex: 1 }}>
              {x.kind === 'offer' ? (x.from.id === mine ? 'You offered' : `You’re taking ${x.from.name}’s shift`) : x.from.id === mine ? `Swap with ${x.to?.name}` : `Swap with ${x.from.name}`}
            </T>
            <Badge label={TRADE_STATUS[x.status].label} tone={TRADE_STATUS[x.status].tone} />
          </View>
          <T size={13}>{shiftText(x.shift)}</T>
          {x.theirShift && <T size={13} muted>for {shiftText(x.theirShift)}</T>}
          {x.adminNote ? <T size={13}>Admin: {x.adminNote}</T> : null}
          {x.from.id === mine && ['open', 'proposed', 'accepted'].includes(x.status) && (
            <Pressable onPress={() => act(x, 'cancel', 'Cancel this?')} hitSlop={8}>
              <T style={{ color: t.bad }}>Cancel</T>
            </Pressable>
          )}
        </Card>
      ))}
    </View>
  );
}
