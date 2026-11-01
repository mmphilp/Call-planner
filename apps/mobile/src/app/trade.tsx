import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Badge, Button, Card, Chip, ErrorText, SectionHeader, T } from '@/components/ui';
import { api, type Schedule, type Trade } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmAsync, notify } from '@/lib/dialogs';
import { KIND_LABEL, longDate, nowLocal, shiftSpan } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const STATUS: Record<Trade['status'], string> = {
  open: 'Offered — waiting for someone to take it',
  proposed: 'Waiting for your colleague to accept',
  accepted: 'Agreed — waiting for admin approval',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
  rejected: 'Rejected by admin',
};

/** Offer one of your shifts to anyone, or propose a swap with a colleague. */
export default function TradeScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const { shiftId, periodId } = useLocalSearchParams<{ shiftId: string; periodId: string }>();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [active, setActive] = useState<Trade | null>(null);
  const [mode, setMode] = useState<'offer' | 'swap'>('offer');
  const [theirs, setTheirs] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Schedule>('GET', `/api/periods/${periodId}/schedule`), api<Trade[]>('GET', '/api/trades')])
      .then(([s, trades]) => {
        setSchedule(s);
        setActive(
          trades.find(
            (x) => x.from.id === user?.id && x.shift?.id === shiftId && ['open', 'proposed', 'accepted'].includes(x.status),
          ) ?? null,
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [periodId, shiftId, user?.id]);

  const shift = schedule?.shifts.find((s) => s.id === shiftId);
  const service = schedule?.services.find((s) => s.id === shift?.serviceId);
  const owner = useMemo(() => new Map(schedule?.assignments.map((a) => [a.shiftId, a.userId])), [schedule]);
  const people = useMemo(() => new Map(schedule?.people.map((p) => [p.id, p.name])), [schedule]);

  // Swap candidates: colleagues' upcoming shifts of the same kind on the same service.
  const candidates = useMemo(() => {
    if (!schedule || !shift) return [];
    const now = nowLocal();
    return schedule.shifts.filter(
      (s) =>
        s.id !== shift.id &&
        s.serviceId === shift.serviceId &&
        s.kind === shift.kind &&
        s.start > now &&
        !s.coveredBy &&
        owner.get(s.id) &&
        owner.get(s.id) !== user?.id,
    );
  }, [schedule, shift, owner, user?.id]);

  const submit = async () => {
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/trades', {
        shiftId: shift.id,
        kind: mode,
        theirShiftId: mode === 'swap' ? theirs : undefined,
        note: note.trim(),
      });
      notify(
        mode === 'offer' ? 'Shift offered' : 'Swap proposed',
        mode === 'offer'
          ? 'Colleagues who cover this service can take it. Once someone does, it goes to the admin to approve.'
          : 'Your colleague can accept it on their Requests tab. Then it goes to the admin to approve.',
      );
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!active || !(await confirmAsync('Cancel this?', 'Your shift stays with you.', 'Cancel it', true))) return;
    try {
      await api('POST', `/api/trades/${active.id}/cancel`, {});
      router.back();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
      <ErrorText message={error} />
      {shift && (
        <Card style={{ gap: 2 }}>
          <T bold size={17}>{longDate(shift.date)}</T>
          <T>
            {service?.name} · {KIND_LABEL[shift.kind]}
          </T>
          <T muted size={13}>{shiftSpan(shift)}</T>
        </Card>
      )}

      {active ? (
        <Card style={{ gap: 10 }}>
          <Badge label={STATUS[active.status]} tone={active.status === 'accepted' ? 'warn' : 'neutral'} />
          <T>
            {active.kind === 'offer'
              ? active.to
                ? `${active.to.name} has taken this shift.`
                : 'You’ve offered this shift.'
              : `Swap with ${active.to?.name} for ${active.theirShift ? longDate(active.theirShift.date) : 'their shift'}.`}
          </T>
          <Button label="Cancel" variant="danger" onPress={cancel} />
        </Card>
      ) : (
        shift && (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="Offer to anyone" selected={mode === 'offer'} onPress={() => setMode('offer')} />
              <Chip label="Swap with a colleague" selected={mode === 'swap'} onPress={() => setMode('swap')} />
            </View>
            <T muted size={13}>
              {mode === 'offer'
                ? `Anyone who covers ${service?.name} can take it. You keep it until the admin approves.`
                : 'Pick a colleague’s shift to trade for. They accept, then the admin approves.'}
            </T>

            {mode === 'swap' && (
              <>
                <SectionHeader>Trade for</SectionHeader>
                {candidates.length === 0 && <T muted>No colleagues’ shifts of this kind are available to swap.</T>}
                <Card style={{ padding: 0 }}>
                  {candidates.map((s, i) => {
                    const selected = theirs === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setTheirs(s.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={{
                          padding: 12,
                          borderTopWidth: i ? 1 : 0,
                          borderColor: t.border,
                          backgroundColor: selected ? t.accent : 'transparent',
                        }}
                      >
                        <T bold style={selected ? { color: t.accentText } : undefined}>
                          {longDate(s.date)}
                        </T>
                        <T size={13} style={{ color: selected ? t.accentText : t.muted }}>
                          {people.get(owner.get(s.id)!)}
                        </T>
                      </Pressable>
                    );
                  })}
                </Card>
              </>
            )}

            <SectionHeader>Note (optional)</SectionHeader>
            <Card style={{ padding: 0 }}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={mode === 'offer' ? 'e.g. Family wedding that weekend' : 'e.g. Happy to take your holiday weekend'}
                placeholderTextColor={t.muted}
                multiline
                maxLength={500}
                style={{ color: t.text, padding: 14, minHeight: 70, fontSize: 15, textAlignVertical: 'top' }}
              />
            </Card>
            <Button
              label={mode === 'offer' ? 'Offer this shift' : 'Propose swap'}
              onPress={submit}
              busy={busy}
              disabled={mode === 'swap' && !theirs}
            />
          </>
        )
      )}
    </ScrollView>
  );
}
