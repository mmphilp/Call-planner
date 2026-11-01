import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Badge, Button, Card, ErrorText, SectionHeader, T } from '@/components/ui';
import { api, type Flag, type Schedule } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmAsync, notify } from '@/lib/dialogs';
import { FLAG_STATUS } from '@/lib/flags';
import { kindLabel, longDate, shiftSpan } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** Flag an assignment in a proposed schedule as a possible error, with a note for the scheduler. */
export default function FlagScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const { shiftId, periodId } = useLocalSearchParams<{ shiftId: string; periodId: string }>();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api<Schedule>('GET', `/api/periods/${periodId}/schedule`), api<Flag[]>('GET', `/api/flags?periodId=${periodId}`)])
      .then(([s, f]) => {
        setSchedule(s);
        setFlags(f.filter((x) => x.shift.id === shiftId));
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, [periodId, shiftId]);

  const shift = schedule?.shifts.find((s) => s.id === shiftId);
  const service = schedule?.services.find((s) => s.id === shift?.serviceId);
  const ownerId = schedule?.assignments.find((a) => a.shiftId === shiftId)?.userId;
  const owner = schedule?.people.find((p) => p.id === ownerId);
  const open = flags.find((f) => f.status === 'open');
  const inReview = schedule?.period.status === 'review';

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/flags', { shiftId, note });
      notify('Sent', 'The scheduler will look at it before the schedule is final.');
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (f: Flag) => {
    if (!(await confirmAsync('Withdraw this flag?', f.note, 'Withdraw', true))) return;
    try {
      await api('POST', `/api/flags/${f.id}/withdraw`, {});
      load();
    } catch (e) {
      notify('Could not withdraw', (e as Error).message);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ErrorText message={error} />
      {shift && (
        <Card style={{ gap: 4 }}>
          <T bold size={17}>{longDate(shift.date)}</T>
          <T>
            {service?.name} · {kindLabel(shift)}
          </T>
          <T muted size={13}>{shiftSpan(shift)}</T>
          <T style={{ marginTop: 6 }}>
            On call: <T bold>{shift.coveredBy ? `${shift.coveredBy} (locum)` : owner ? (owner.id === user?.id ? 'You' : owner.name) : 'Nobody yet'}</T>
          </T>
        </Card>
      )}

      {flags.length > 0 && <SectionHeader>Your flags on this shift</SectionHeader>}
      {flags.map((f) => (
        <Card key={f.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <T style={{ flex: 1 }}>“{f.note}”</T>
            <Badge label={FLAG_STATUS[f.status].label} tone={FLAG_STATUS[f.status].tone} />
          </View>
          {f.adminNote ? <T size={13}>Scheduler: {f.adminNote}</T> : null}
          {f.status === 'open' && (
            <Pressable onPress={() => withdraw(f)} hitSlop={8}>
              <T style={{ color: t.bad }}>Withdraw</T>
            </Pressable>
          )}
        </Card>
      ))}

      {schedule && !inReview && <T muted>This schedule isn’t out for review any more, so it can’t be flagged.</T>}
      {inReview && !open && (
        <>
          <T muted>
            This schedule is proposed, not final. If this assignment looks wrong, tell the scheduler why. They’ll review it before
            publishing.
          </T>
          <Card style={{ padding: 0 }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. I’m away that week; I requested it off"
              placeholderTextColor={t.muted}
              multiline
              maxLength={1000}
              style={{ color: t.text, padding: 14, minHeight: 90, fontSize: 15, textAlignVertical: 'top' }}
            />
          </Card>
          <Button label="Send to scheduler" onPress={send} busy={busy} disabled={!note.trim()} />
        </>
      )}
    </ScrollView>
  );
}
