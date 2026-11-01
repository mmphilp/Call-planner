import { describe, expect, it } from 'vitest';
import {
  standardHolidays,
  applyTeamRules,
  backupMap,
  coverFromBackup,
  evaluateSchedule,
  generateShifts,
  halfYearRange,
  optimizeSchedule,
  planWeeks,
  weekStart,
  type CallRequest,
  type Service,
  type Surgeon,
} from '../src';

const general: Service = {
  id: 'gen',
  name: 'General',
  coversWeekdayDay: true,
  coversWeekdayNight: true,
  coversWeekend: true,
};
const trauma: Service = {
  id: 'trauma',
  name: 'Trauma',
  coversWeekdayDay: true,
  coversWeekdayNight: false,
  coversWeekend: false,
};

describe('generateShifts', () => {
  it('creates day, night and weekend shifts for one week', () => {
    // 2027-01-04 is a Monday.
    const shifts = generateShifts({ start: '2027-01-04', end: '2027-01-10', services: [general] });
    const kinds = shifts.map((s) => `${s.kind}:${s.date}`);
    expect(kinds.filter((k) => k.startsWith('day'))).toHaveLength(5);
    expect(kinds.filter((k) => k.startsWith('night'))).toEqual([
      'night:2027-01-04',
      'night:2027-01-05',
      'night:2027-01-06',
      'night:2027-01-07',
    ]);
    const weekend = shifts.find((s) => s.kind === 'weekend')!;
    expect(weekend.start).toBe('2027-01-08T17:00');
    expect(weekend.end).toBe('2027-01-11T07:00');
    const night = shifts.find((s) => s.id === 'gen:night:2027-01-04')!;
    expect(night.end).toBe('2027-01-05T07:00');
  });

  it('only creates the coverage a service needs', () => {
    const shifts = generateShifts({ start: '2027-01-04', end: '2027-01-10', services: [trauma] });
    expect(shifts.every((s) => s.kind === 'day')).toBe(true);
    expect(shifts).toHaveLength(5);
  });

  it('stretches the weekend over a Monday holiday', () => {
    // 2027-01-18 is MLK day (Monday).
    const shifts = generateShifts({
      start: '2027-01-11',
      end: '2027-01-24',
      services: [general],
      holidays: ['2027-01-18'],
    });
    const weekend = shifts.find((s) => s.id === 'gen:weekend:2027-01-15')!;
    expect(weekend.end).toBe('2027-01-19T07:00');
    expect(weekend.holiday).toBe(true);
    expect(shifts.find((s) => s.id === 'gen:day:2027-01-18')).toBeUndefined();
    expect(shifts.find((s) => s.id === 'gen:night:2027-01-18')).toBeUndefined();
  });

  it('leaves Friday nights and holiday days to a shared weekend service', () => {
    // A multi-specialty group: each specialty covers its own weekdays, and a
    // shared service covers every weekend block.
    const colorectal: Service = { id: 'crs', name: 'Colorectal', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: false };
    const shared: Service = { id: 'wk', name: 'Specialty Coverage', coversWeekdayDay: false, coversWeekdayNight: false, coversWeekend: true };
    const shifts = generateShifts({
      start: '2027-01-11',
      end: '2027-01-24',
      services: [colorectal, shared],
      holidays: ['2027-01-18'],
    });
    const ids = new Set(shifts.map((s) => s.id));
    expect(ids.has('crs:night:2027-01-14')).toBe(true);
    expect(ids.has('crs:night:2027-01-15')).toBe(false); // Friday night → weekend block
    expect(ids.has('crs:day:2027-01-15')).toBe(true);
    expect(ids.has('crs:day:2027-01-18')).toBe(false); // MLK day → long weekend
    expect(ids.has('crs:night:2027-01-18')).toBe(false);
    expect(ids.has('crs:day:2027-01-19')).toBe(true);
    expect(shifts.find((s) => s.id === 'wk:weekend:2027-01-15')!.end).toBe('2027-01-19T07:00');
  });

  it('gives every weekday holiday to the weekend service only', () => {
    const colorectal: Service = { id: 'crs', name: 'Colorectal', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: false };
    const shared: Service = { id: 'wk', name: 'Specialty Coverage', coversWeekdayDay: false, coversWeekdayNight: false, coversWeekend: true };
    // Observed July 4th (Fri), Labor Day (Mon), Thanksgiving (Thu, with the Friday
    // after as a bridge day), Christmas Eve and Day (Thu–Fri), and a mid-week holiday.
    const shifts = generateShifts({
      start: '2026-07-01',
      end: '2026-12-31',
      services: [colorectal, shared],
      holidays: ['2026-07-03', '2026-09-07', '2026-11-26', '2026-12-24', '2026-12-25', '2026-10-14'],
      bridgeDays: ['2026-11-27'],
    });
    const ids = new Set(shifts.map((s) => s.id));
    const span = (id: string) => {
      const s = shifts.find((x) => x.id === id)!;
      return `${s.start} → ${s.end}${s.holiday ? ' (holiday)' : ''}`;
    };
    for (const d of ['2026-07-03', '2026-09-07', '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-10-14']) {
      expect(ids.has(`crs:day:${d}`)).toBe(false);
      expect(ids.has(`crs:night:${d}`)).toBe(false);
    }
    // The night before a holiday stays with the team; the block starts at 7am on the holiday.
    expect(span('wk:weekend:2026-07-03')).toBe('2026-07-03T07:00 → 2026-07-06T07:00 (holiday)');
    expect(ids.has('crs:night:2026-07-02')).toBe(true);
    expect(span('wk:weekend:2026-09-04')).toBe('2026-09-04T17:00 → 2026-09-08T07:00 (holiday)');
    // Thanksgiving runs through the Friday after into the weekend.
    expect(span('wk:weekend:2026-11-27')).toBe('2026-11-26T07:00 → 2026-11-30T07:00 (holiday)');
    expect(ids.has('wk:weekend:2026-11-26')).toBe(false);
    expect(ids.has('crs:night:2026-11-25')).toBe(true);
    // Christmas Eve and Day: one block from 7am Christmas Eve.
    expect(span('wk:weekend:2026-12-25')).toBe('2026-12-24T07:00 → 2026-12-28T07:00 (holiday)');
    expect(ids.has('crs:night:2026-12-23')).toBe(true);
    // A mid-week holiday on its own: 7am to 7am.
    expect(span('wk:weekend:2026-10-14')).toBe('2026-10-14T07:00 → 2026-10-15T07:00 (holiday)');
    expect(ids.has('crs:night:2026-10-13')).toBe(true);
    expect(ids.has('crs:day:2026-10-15')).toBe(true);
  });

  it('keeps weekday holiday shifts for a group with no weekend service', () => {
    const weekdaysOnly: Service = { ...general, coversWeekend: false };
    const shifts = generateShifts({ start: '2026-11-23', end: '2026-11-29', services: [weekdaysOnly], holidays: ['2026-11-26'] });
    expect(shifts.find((s) => s.id === 'gen:day:2026-11-26')?.holiday).toBe(true);
    expect(shifts.some((s) => s.kind === 'weekend')).toBe(false);
  });

  it('covers a full half year', () => {
    const { start, end } = halfYearRange(2027, 1);
    const shifts = generateShifts({ start, end, services: [general] });
    expect(shifts.filter((s) => s.kind === 'weekend')).toHaveLength(26);
  });
});

function surgeons(count: number, serviceIds = ['gen']): Surgeon[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `u${i + 1}`,
    name: `Surgeon ${i + 1}`,
    fte: 1,
    serviceIds,
  }));
}

describe('optimizeSchedule', () => {
  const { start, end } = halfYearRange(2027, 1);
  const shifts = generateShifts({ start, end, services: [general, trauma] });
  const team = surgeons(10, ['gen', 'trauma']);

  it('fills every shift without breaking hard rules', () => {
    const result = optimizeSchedule({ shifts, surgeons: team, requests: [], seed: 7 });
    expect(result.unassignedShiftIds).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.assignments).toHaveLength(shifts.length);
  });

  it('spreads weekends fairly', () => {
    const result = optimizeSchedule({ shifts, surgeons: team, requests: [], seed: 3 });
    const weekends = result.stats.map((s) => s.counts.weekend);
    expect(Math.max(...weekends) - Math.min(...weekends)).toBeLessThanOrEqual(1);
    const nights = result.stats.map((s) => s.counts.night);
    expect(Math.max(...nights) - Math.min(...nights)).toBeLessThanOrEqual(2);
  });

  it('gives a half-FTE surgeon about half the call', () => {
    const mixed = team.map((s, i) => (i === 0 ? { ...s, fte: 0.5 } : s));
    const result = optimizeSchedule({ shifts, surgeons: mixed, requests: [], seed: 5 });
    const half = result.stats.find((s) => s.userId === 'u1')!;
    const full = result.stats.find((s) => s.userId === 'u2')!;
    expect(half.counts.weekend).toBeLessThan(full.counts.weekend);
    expect(half.counts.day + half.counts.night).toBeLessThan(full.counts.day + full.counts.night);
  });

  it('never schedules approved time off and honours preferences', () => {
    const requests: CallRequest[] = [
      { id: 'r1', userId: 'u1', type: 'unavailable', status: 'approved', startDate: '2027-03-01', endDate: '2027-03-14' },
      { id: 'r2', userId: 'u2', type: 'prefer_off', status: 'pending', startDate: '2027-02-05', endDate: '2027-02-08', shiftKinds: ['weekend'] },
      { id: 'r3', userId: 'u3', type: 'prefer_on', status: 'pending', startDate: '2027-04-09', endDate: '2027-04-12', shiftKinds: ['weekend'] },
    ];
    const result = optimizeSchedule({ shifts, surgeons: team, requests, seed: 11 });
    expect(result.violations).toEqual([]);
    expect(result.requestOutcomes.every((o) => o.honored)).toBe(true);
    const gw = result.assignments.find((a) => a.shiftId === 'gen:weekend:2027-04-09');
    expect(gw?.userId).toBe('u3');
  });

  it('keeps locked assignments', () => {
    const locked = [{ shiftId: 'gen:weekend:2027-01-01', userId: 'u4', locked: true }];
    const result = optimizeSchedule({ shifts, surgeons: team, requests: [], locked, seed: 2 });
    expect(result.assignments.find((a) => a.shiftId === 'gen:weekend:2027-01-01')?.userId).toBe('u4');
  });

  it('leaves a shift open rather than breaking a rule', () => {
    const tiny = generateShifts({ start: '2027-01-04', end: '2027-01-05', services: [general] });
    // One surgeon cannot take both the day and the overlapping-rest night.
    const result = optimizeSchedule({ shifts: tiny, surgeons: surgeons(1), requests: [] });
    expect(result.violations.filter((v) => v.type !== 'unassigned')).toEqual([]);
    expect(result.unassignedShiftIds.length).toBeGreaterThan(0);
  });
});

describe('evaluateSchedule', () => {
  it('flags manual edits that break rules', () => {
    const shifts = generateShifts({ start: '2027-01-04', end: '2027-01-05', services: [general] });
    const team = surgeons(2);
    const report = evaluateSchedule({
      shifts,
      surgeons: team,
      requests: [{ id: 'r', userId: 'u2', type: 'unavailable', status: 'approved', startDate: '2027-01-05', endDate: '2027-01-05' }],
      assignments: [
        { shiftId: 'gen:day:2027-01-04', userId: 'u1' },
        { shiftId: 'gen:night:2027-01-04', userId: 'u1' },
        { shiftId: 'gen:day:2027-01-05', userId: 'u2' },
      ],
    });
    const types = report.violations.map((v) => v.type).sort();
    expect(types).toEqual(['rest', 'unassigned', 'unavailable']);
  });
});

describe('realistic half year', () => {
  const { start, end } = halfYearRange(2027, 1);
  const services: Service[] = ['a', 'b', 'c'].map((id) => ({
    id,
    name: id,
    coversWeekdayDay: true,
    coversWeekdayNight: true,
    coversWeekend: true,
  }));
  const shifts = generateShifts({ start, end, services, holidays: ['2027-01-18', '2027-02-15', '2027-05-31'] });
  // Mixed credentials and one half-time surgeon.
  const team: Surgeon[] = Array.from({ length: 14 }, (_, i) => ({
    id: `u${i + 1}`,
    name: `Surgeon ${i + 1}`,
    fte: i === 0 ? 0.5 : 1,
    serviceIds: i < 5 ? ['a', 'b', 'c'] : i < 10 ? ['a', 'b'] : ['b', 'c'],
  }));
  const requests: CallRequest[] = [
    { id: 'r1', userId: 'u1', type: 'unavailable', status: 'approved', startDate: '2027-03-01', endDate: '2027-03-14' },
    { id: 'r2', userId: 'u2', type: 'prefer_off', status: 'pending', startDate: '2027-02-05', endDate: '2027-02-08', shiftKinds: ['weekend'] },
    { id: 'r3', userId: 'u3', type: 'prefer_on', status: 'pending', startDate: '2027-04-09', endDate: '2027-04-12', shiftKinds: ['weekend'] },
    { id: 'r4', userId: 'u7', type: 'unavailable', status: 'pending', startDate: '2027-05-10', endDate: '2027-05-16' },
  ];

  it.each([1, 2, 3])('balances load equally per FTE and honours requests (seed %i)', (seed) => {
    const result = optimizeSchedule({ shifts, surgeons: team, requests, seed });
    expect(result.violations).toEqual([]);
    expect(result.requestOutcomes.filter((o) => !o.honored)).toEqual([]);
    const fullTime = result.stats.slice(1);
    for (const kind of ['day', 'night', 'weekend'] as const) {
      const counts = fullTime.map((s) => s.counts[kind]);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  }, 30_000);
});

describe('preferred rest', () => {
  it('only shortens rest where a shift could not otherwise be covered', () => {
    // Two surgeons, one week: covering every shift forces some back-to-back
    // work, but far fewer pairs than ignoring rest entirely.
    const shifts = generateShifts({ start: '2027-01-04', end: '2027-01-10', services: [general] });
    const team = surgeons(2);
    const countShort = (rules: object) => {
      const r = optimizeSchedule({ shifts, surgeons: team, requests: [], rules: { maxNightsPerWeek: 4, ...rules }, seed: 1 });
      const start = new Map(shifts.map((s) => [s.id, s]));
      let short = 0;
      for (const u of team) {
        const mine = r.assignments.filter((a) => a.userId === u.id).map((a) => start.get(a.shiftId)!).sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 1; i < mine.length; i++) if (mine[i].start === mine[i - 1].end) short++;
      }
      return { unfilled: r.unassignedShiftIds.length, short };
    };
    const strict = countShort({});
    const soft = countShort({ minRestHours: 0, preferredRestHours: 12 });
    const ignored = countShort({ minRestHours: 0, preferredRestHours: 0 });
    expect(strict.unfilled).toBeGreaterThan(0);
    expect(soft.unfilled).toBe(0);
    expect(soft.short).toBeLessThanOrEqual(ignored.short);
  });
});

describe('small teams', () => {
  const { start, end } = halfYearRange(2027, 1);
  const crs: Service = { id: 'crs', name: 'Colorectal', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: false, weekdayMode: 'week' };
  const endo: Service = { id: 'endo', name: 'Endocrine', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: false, weekdayMode: 'week' };
  const shared: Service = { id: 'wk', name: 'Specialty Coverage', coversWeekdayDay: false, coversWeekdayNight: false, coversWeekend: true };
  const services = [crs, endo, shared];
  const team: Surgeon[] = [
    { id: 'philp', name: 'P', fte: 1, serviceIds: ['crs', 'wk'] },
    { id: 'goda', name: 'G', fte: 1, serviceIds: ['crs', 'wk'] },
    { id: 'kuo', name: 'K', fte: 1, serviceIds: ['endo', 'wk'] },
    { id: 'soans', name: 'S', fte: 1, serviceIds: ['wk'] },
  ];
  const shifts = applyTeamRules(generateShifts({ start, end, services }), services);
  const requests: CallRequest[] = [
    // Philp is away Wed–Fri one week, so Goda should take that whole week.
    { id: 'r1', userId: 'philp', type: 'unavailable', status: 'approved', startDate: '2027-03-10', endDate: '2027-03-12' },
    // Both colorectal surgeons are away part of this week: it is filled day by day.
    { id: 'r2', userId: 'philp', type: 'unavailable', status: 'approved', startDate: '2027-04-05', endDate: '2027-04-06' },
    { id: 'r3', userId: 'goda', type: 'unavailable', status: 'approved', startDate: '2027-04-08', endDate: '2027-04-09' },
  ];

  it('gives whole weeks to one surgeon, alternating, and fills split weeks by day', () => {
    const weeks = planWeeks({ shifts, surgeons: team, requests, services, seed: 1 });
    const result = optimizeSchedule({ shifts, surgeons: team, requests, locked: weeks, seed: 1 });
    expect(result.violations).toEqual([]);
    expect(result.unassignedShiftIds).toEqual([]);
    const who = new Map(result.assignments.map((a) => [a.shiftId, a.userId]));

    // Every endocrine weekday shift goes to the team of one.
    expect(shifts.filter((s) => s.serviceId === 'endo').every((s) => who.get(s.id) === 'kuo')).toBe(true);

    // Colorectal weeks: one owner each (except the split week), split evenly, rarely back to back.
    const byWeek = new Map<string, Set<string>>();
    for (const s of shifts.filter((s) => s.serviceId === 'crs')) {
      const wk = weekStart(s.date);
      byWeek.set(wk, (byWeek.get(wk) ?? new Set()).add(who.get(s.id)!));
    }
    const split = [...byWeek].filter(([, owners]) => owners.size > 1).map(([wk]) => wk);
    expect(split).toEqual(['2027-04-05']);
    expect([...byWeek.get('2027-03-08')!]).toEqual(['goda']);
    const owners = [...byWeek].filter(([wk]) => !split.includes(wk)).map(([, o]) => [...o][0]);
    const philpWeeks = owners.filter((o) => o === 'philp').length;
    expect(Math.abs(philpWeeks - (owners.length - philpWeeks))).toBeLessThanOrEqual(2);
    const repeats = owners.filter((o, i) => i > 0 && o === owners[i - 1]).length;
    expect(repeats).toBeLessThanOrEqual(3);

    // Weekends are still shared by everyone.
    const weekends = result.stats.map((s) => s.counts.weekend);
    expect(Math.max(...weekends) - Math.min(...weekends)).toBeLessThanOrEqual(1);
  }, 30_000);
});

describe('cross-cover between teams', () => {
  it('gives a one-person team’s gaps to the covering service’s on-call surgeon without breaking rules', () => {
    const { start, end } = halfYearRange(2027, 1);
    const crs: Service = { id: 'crs', name: 'Colorectal', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: false, weekdayMode: 'week' };
    const endo: Service = { id: 'endo', name: 'Endocrine', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: false, weekdayMode: 'week', backupServiceId: 'crs' };
    const services = [crs, endo];
    const team: Surgeon[] = [
      { id: 'philp', name: 'P', fte: 1, serviceIds: ['crs'] },
      { id: 'goda', name: 'G', fte: 1, serviceIds: ['crs'] },
      { id: 'kuo', name: 'K', fte: 1, serviceIds: ['endo'] },
    ];
    const shifts = applyTeamRules(generateShifts({ start, end, services }), services);
    const requests: CallRequest[] = [
      { id: 'away', userId: 'kuo', type: 'unavailable', status: 'approved', startDate: '2027-03-01', endDate: '2027-03-12' },
    ];
    const weeks = planWeeks({ shifts, surgeons: team, requests, services, seed: 1 });
    const first = optimizeSchedule({ shifts, surgeons: team, requests, locked: weeks, seed: 1 });
    const covered = coverFromBackup(shifts, first.assignments, services);
    expect(covered.length).toBe(first.unassignedShiftIds.length);
    const all = [...first.assignments, ...covered];
    const who = new Map(all.map((a) => [a.shiftId, a.userId]));
    for (const s of shifts.filter((x) => x.serviceId === 'endo' && x.date >= '2027-03-01' && x.date <= '2027-03-12')) {
      expect(who.get(s.id)).toBe(who.get(s.id.replace('endo:', 'crs:')));
    }
    const report = evaluateSchedule({ shifts, surgeons: team, requests, assignments: all, backups: backupMap(services) });
    expect(report.violations).toEqual([]);
  }, 30_000);
});

describe('holidays', () => {
  it('knows the group’s holidays and their usual observed days', () => {
    expect(standardHolidays(2026).map((h) => `${h.name}: ${h.date} (${h.observed})`)).toEqual([
      'New Year’s Day: 2026-01-01 (2026-01-01)',
      'Memorial Day: 2026-05-25 (2026-05-25)',
      'Juneteenth: 2026-06-19 (2026-06-19)',
      'Fourth of July: 2026-07-04 (2026-07-03)',
      'Labor Day: 2026-09-07 (2026-09-07)',
      'Thanksgiving: 2026-11-26 (2026-11-26)',
      'Christmas Eve: 2026-12-24 (2026-12-24)',
      'Christmas: 2026-12-25 (2026-12-25)',
    ]);
    expect(standardHolidays(2027).find((h) => h.name === 'Christmas')!.observed).toBe('2027-12-24');
    // Christmas Eve on a Sunday is observed the Friday before; Christmas takes the Monday.
    expect(standardHolidays(2028).filter((h) => h.name.startsWith('Christmas')).map((h) => h.observed)).toEqual(['2028-12-22', '2028-12-25']);
  });

  it('rotates a holiday away from whoever had it last time', () => {
    const shifts = generateShifts({ start: '2027-12-20', end: '2027-12-31', services: [general], holidays: ['2027-12-24'] })
      .map((s) => (s.holiday ? { ...s, holidayName: 'Christmas' } : s));
    const team = surgeons(4);
    const xmas = shifts.find((s) => s.kind === 'weekend' && s.holidayName)!;
    for (const seed of [1, 2, 3, 4, 5]) {
      // Without history, someone gets it; with u1 and u2 having had it, it goes to u3 or u4.
      const r = optimizeSchedule({ shifts, surgeons: team, requests: [], seed, holidayHistory: { u1: ['Christmas'], u2: ['Christmas'] } });
      const who = r.assignments.find((a) => a.shiftId === xmas.id)!.userId;
      expect(['u3', 'u4']).toContain(who);
    }
  });
});
