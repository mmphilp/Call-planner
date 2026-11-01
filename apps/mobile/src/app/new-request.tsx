import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Button, Card, Chip, ErrorText, SectionHeader, T } from '@/components/ui';
import { RangeCalendar } from '@/components/RangeCalendar';
import { api, type Period, type RequestType, type ShiftKind } from '@/lib/api';
import { addDays, consecutiveRuns, dateRange, todayStr } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const TYPES: { value: RequestType; label: string; help: string }[] = [
  { value: 'unavailable', label: 'Unavailable', help: 'Vacation, conference, leave. Once approved you won’t be scheduled.' },
  { value: 'prefer_off', label: 'Prefer off', help: 'You’d rather not, but can if needed.' },
  { value: 'prefer_on', label: 'Would like call', help: 'You’d like to be on call these dates.' },
];

const KINDS: { value: ShiftKind; label: string }[] = [
  { value: 'day', label: 'Weekday days' },
  { value: 'night', label: 'Weekday nights' },
  { value: 'weekend', label: 'Weekends' },
];

export default function NewRequestScreen() {
  const t = useTheme();
  const { periodId } = useLocalSearchParams<{ periodId: string }>();
  const [period, setPeriod] = useState<Period | null>(null);
  const [type, setType] = useState<RequestType>('unavailable');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  // 'range': one continuous stretch; 'days': any separate days (one request per run of days).
  const [mode, setMode] = useState<'range' | 'days'>('range');
  const [days, setDays] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<ShiftKind[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Period>('GET', `/api/periods/${periodId}`).then(setPeriod).catch((e: Error) => setError(e.message));
  }, [periodId]);

  const runs: [string, string][] =
    mode === 'days' ? consecutiveRuns([...days]) : start ? [[start, end ?? start]] : [];

  const submit = async () => {
    if (!runs.length || !period) return;
    setBusy(true);
    setError(null);
    const sent: string[] = [];
    try {
      for (const [from, to] of runs) {
        await api('POST', '/api/requests', {
          periodId: period.id,
          type,
          startDate: from,
          endDate: to,
          shiftKinds: kinds,
          note: note.trim(),
        });
        sent.push(from);
      }
      router.back();
    } catch (e) {
      // Keep only the days that still need sending so a retry doesn't duplicate.
      if (mode === 'days' && sent.length) {
        const done = runs.filter(([from]) => sent.includes(from));
        setDays(new Set([...days].filter((d) => !done.some(([a, b]) => d >= a && d <= b))));
        setError(`${(e as Error).message} (${sent.length} of ${runs.length} sent; the rest are still selected.)`);
      } else {
        setError((e as Error).message);
      }
      setBusy(false);
    }
  };

  const toggleDay = (d: string) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setDays(next);
  };

  const toggleKind = (k: ShiftKind) => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);
  const min = period ? (period.startDate > todayStr() ? period.startDate : todayStr()) : todayStr();

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
      <ErrorText message={error} />
      {period && <T muted>{period.label}</T>}

      <SectionHeader>What kind of request?</SectionHeader>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TYPES.map((x) => (
          <Chip key={x.value} label={x.label} selected={type === x.value} onPress={() => setType(x.value)} />
        ))}
      </View>
      <T muted size={13}>{TYPES.find((x) => x.value === type)!.help}</T>

      <SectionHeader>Dates</SectionHeader>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Date range" selected={mode === 'range'} onPress={() => setMode('range')} />
        <Chip label="Separate days" selected={mode === 'days'} onPress={() => setMode('days')} />
      </View>
      {period && mode === 'range' && (
        <RangeCalendar
          min={min}
          max={addDays(period.endDate, 3)}
          start={start}
          end={end}
          onChange={(s, e) => {
            setStart(s);
            setEnd(e);
          }}
        />
      )}
      {period && mode === 'days' && (
        <RangeCalendar min={min} max={addDays(period.endDate, 3)} days={days} onToggleDay={toggleDay} />
      )}
      <T muted size={13}>
        {mode === 'range'
          ? start
            ? dateRange(start, end ?? start)
            : 'Tap a start date, then an end date (or just one day).'
          : runs.length
            ? `${runs.map(([a, b]) => dateRange(a, b)).join('; ')}${runs.length > 1 ? ` — sent as ${runs.length} requests` : ''}`
            : 'Tap each day you want. Use the arrows to pick days in other months.'}
      </T>

      <SectionHeader>Which call? (optional)</SectionHeader>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {KINDS.map((k) => (
          <Chip key={k.value} label={k.label} selected={kinds.includes(k.value)} onPress={() => toggleKind(k.value)} />
        ))}
      </View>
      <T muted size={13}>{kinds.length ? 'Only the selected kinds of call.' : 'Leave blank for all call in these dates.'}</T>

      <SectionHeader>Note for the scheduler</SectionHeader>
      <Card style={{ padding: 0 }}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Family wedding out of town"
          placeholderTextColor={t.muted}
          multiline
          maxLength={500}
          style={{ color: t.text, padding: 14, minHeight: 80, fontSize: 15, textAlignVertical: 'top' }}
        />
      </Card>

      <Button
        label={runs.length > 1 ? `Send ${runs.length} requests` : 'Send request'}
        onPress={submit}
        busy={busy}
        disabled={!runs.length || !period}
      />
    </ScrollView>
  );
}
