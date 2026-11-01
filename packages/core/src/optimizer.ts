import { addDays, longDate, toMinutes, weekStart } from './dates';
import {
  mergeRules,
  SHIFT_KINDS,
  type Assignment,
  type CallRequest,
  type Rules,
  type Shift,
  type ShiftKind,
  type Surgeon,
} from './types';

export interface OptimizeInput {
  shifts: Shift[];
  surgeons: Surgeon[];
  requests: CallRequest[];
  rules?: Partial<Rules> | null;
  /** Assignments the optimizer must keep as-is (admin-locked). */
  locked?: Assignment[];
  seed?: number;
  iterations?: number;
  /** serviceId → service that covers it when the team is away (see coverFromBackup). */
  backups?: Record<string, string>;
}

export interface SurgeonStats {
  userId: string;
  name: string;
  counts: Record<ShiftKind, number>;
  targets: Record<ShiftKind, number>;
  holidays: number;
  holidayTarget: number;
}

export interface RequestOutcome {
  requestId: string;
  userId: string;
  type: CallRequest['type'];
  honored: boolean;
  conflictingShiftIds: string[];
}

export type ViolationType =
  | 'unassigned'
  | 'ineligible'
  | 'unavailable'
  | 'rest'
  | 'nights_per_week'
  | 'weekend_gap';

export interface Violation {
  type: ViolationType;
  shiftIds: string[];
  userId?: string;
  message: string;
}

export interface OptimizeResult {
  assignments: Assignment[];
  unassignedShiftIds: string[];
  stats: SurgeonStats[];
  requestOutcomes: RequestOutcome[];
  violations: Violation[];
  cost: number;
}

const HARD_PENALTY = 1_000_000;
/** Starting penalty for a broken rule during annealing; it ramps up to HARD_PENALTY. */
const INITIAL_RULE_PENALTY = 200;
const UNASSIGNED_PENALTY = 10_000;

interface Score {
  soft: number;
  hard: number;
}

function total(s: Score, rulePenalty: number): number {
  return s.soft + s.hard * rulePenalty;
}

interface ShiftInfo {
  shift: Shift;
  startMin: number;
  endMin: number;
  week: string;
}

/** Everything precomputed from the inputs that the scoring functions need. */
class Model {
  rules: Rules;
  info: ShiftInfo[];
  indexById = new Map<string, number>();
  surgeons: Surgeon[];
  surgeonById = new Map<string, Surgeon>();
  /** Per shift: surgeons allowed to take it (eligible and not approved-unavailable). */
  candidates: string[][];
  /** Per shift: soft preference cost for each surgeon (negative = wanted). */
  prefCost: Map<string, number>[];
  targets = new Map<string, Record<ShiftKind, number>>();
  holidayTargets = new Map<string, number>();

  backups: Record<string, string>;

  constructor(input: OptimizeInput) {
    this.rules = mergeRules(input.rules);
    this.backups = input.backups ?? {};
    this.surgeons = input.surgeons;
    for (const s of input.surgeons) this.surgeonById.set(s.id, s);
    this.info = [...input.shifts]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((shift) => ({
        shift,
        startMin: toMinutes(shift.start),
        endMin: toMinutes(shift.end),
        week: weekStart(shift.date),
      }));
    this.info.forEach((s, i) => this.indexById.set(s.shift.id, i));

    const active = input.requests.filter((r) => r.status !== 'denied');
    this.candidates = this.info.map(({ shift }) =>
      input.surgeons
        .filter((u) => u.serviceIds.includes(shift.serviceId))
        .filter(
          (u) =>
            !active.some(
              (r) =>
                r.userId === u.id &&
                r.type === 'unavailable' &&
                r.status === 'approved' &&
                requestCovers(r, shift),
            ),
        )
        .map((u) => u.id),
    );

    const w = this.rules.weights;
    this.prefCost = this.info.map(({ shift }) => {
      const m = new Map<string, number>();
      for (const r of active) {
        if (!requestCovers(r, shift)) continue;
        let c = 0;
        if (r.type === 'prefer_off') c = w.preferOff;
        else if (r.type === 'prefer_on') c = -w.preferOn;
        else if (r.type === 'unavailable' && r.status === 'pending') c = w.pendingUnavailable;
        if (c) m.set(r.userId, (m.get(r.userId) ?? 0) + c);
      }
      return m;
    });

    // Fair share, per kind of shift: surgeons who can cover the same services
    // form a pool (a team, or the whole group for shared weekends), and
    // everyone in a pool carries the same load per FTE. Pools are linked
    // through shared services, so overlapping credentials still balance.
    for (const u of input.surgeons) {
      this.targets.set(u.id, { day: 0, night: 0, weekend: 0 });
      this.holidayTargets.set(u.id, 0);
    }
    for (const kind of SHIFT_KINDS) {
      const ofKind = this.info.filter(({ shift }) => shift.kind === kind).map(({ shift }) => shift);
      for (const { members, shifts } of pools(input.surgeons, ofKind)) {
        const totalFte = members.reduce((s, u) => s + u.fte, 0);
        if (!totalFte) continue;
        const holidayCount = shifts.filter((s) => s.holiday).length;
        for (const u of members) {
          this.targets.get(u.id)![kind] = (shifts.length * u.fte) / totalFte;
          this.holidayTargets.set(u.id, this.holidayTargets.get(u.id)! + (holidayCount * u.fte) / totalFte);
        }
      }
    }
  }

  /**
   * The same person on two services' identical shifts because of cross-cover:
   * one service backs up the other, or both are covered by the same service
   * (e.g. two one-person teams away on the same day).
   */
  isCrossCover(a: Shift, b: Shift): boolean {
    if (a.start !== b.start || a.end !== b.end || a.serviceId === b.serviceId) return false;
    const ba = this.backups[a.serviceId];
    const bb = this.backups[b.serviceId];
    return ba === b.serviceId || bb === a.serviceId || (!!ba && ba === bb);
  }

  /** Hard-rule violations within one surgeon's sorted shift list. */
  hardViolations(list: number[]): Violation[] {
    const out: Violation[] = [];
    const r = this.rules;
    for (let i = 1; i < list.length; i++) {
      const prev = this.info[list[i - 1]];
      const cur = this.info[list[i]];
      if (this.isCrossCover(prev.shift, cur.shift)) continue;
      const gapHours = (cur.startMin - prev.endMin) / 60;
      // Teams that work in weeks (or opt out) don't apply rest rules to their weekday call.
      const relaxed = prev.shift.relaxed || cur.shift.relaxed;
      if (gapHours < (relaxed ? 0 : r.minRestHours)) {
        out.push({
          type: 'rest',
          shiftIds: [prev.shift.id, cur.shift.id],
          message:
            gapHours < 0
              ? 'Overlapping shifts'
              : `Only ${gapHours}h rest between shifts (min ${r.minRestHours}h)`,
        });
      }
    }
    const nights = new Map<string, number[]>();
    const nightStarts = new Set<number>();
    for (const i of list) {
      if (this.info[i].shift.kind !== 'night' || this.info[i].shift.relaxed) continue;
      // Covering another service the same night is still one night.
      if (nightStarts.has(this.info[i].startMin)) continue;
      nightStarts.add(this.info[i].startMin);
      const wk = this.info[i].week;
      nights.set(wk, [...(nights.get(wk) ?? []), i]);
    }
    for (const [wk, idxs] of nights) {
      if (idxs.length > r.maxNightsPerWeek) {
        out.push({
          type: 'nights_per_week',
          shiftIds: idxs.map((i) => this.info[i].shift.id),
          message: `${idxs.length} nights in the week of ${longDate(wk)} (max ${r.maxNightsPerWeek})`,
        });
      }
    }
    const weekends = list.filter((i) => this.info[i].shift.kind === 'weekend');
    const minGapDays = (r.minWeekendsOffBetween + 1) * 7;
    for (let i = 1; i < weekends.length; i++) {
      const a = this.info[weekends[i - 1]];
      const b = this.info[weekends[i]];
      const days = Math.round((b.startMin - a.startMin) / 1440);
      if (days > 0 && days < minGapDays) {
        out.push({
          type: 'weekend_gap',
          shiftIds: [a.shift.id, b.shift.id],
          message: `Weekends of ${longDate(a.shift.date, { weekday: false })} and ${longDate(b.shift.date, { weekday: false })} are too close together`,
        });
      }
    }
    return out;
  }

  score(userId: string, list: number[]): Score {
    const r = this.rules;
    let cost = 0;

    const counts: Record<ShiftKind, number> = { day: 0, night: 0, weekend: 0 };
    let holidays = 0;
    for (const i of list) {
      const s = this.info[i].shift;
      counts[s.kind]++;
      if (s.holiday) holidays++;
      cost += this.prefCost[i].get(userId) ?? 0;
    }
    const target = this.targets.get(userId)!;
    for (const k of SHIFT_KINDS) {
      cost += r.weights.fairness * r.kindWeights[k] * (counts[k] - target[k]) ** 2;
    }
    cost += r.weights.holiday * (holidays - this.holidayTargets.get(userId)!) ** 2;

    for (let i = 1; i < list.length; i++) {
      const prev = this.info[list[i - 1]];
      const cur = this.info[list[i]];
      // Within a week-long / small team's weekday call, back-to-back is the
      // norm, so it costs nothing. Running from that into a weekend only gets
      // the light spacing cost: enough to pick who takes a weekend, never
      // enough to unbalance weekends for a one-person team that can't avoid it.
      if ((prev.shift.relaxed && cur.shift.relaxed) || this.isCrossCover(prev.shift, cur.shift)) continue;
      const days = (cur.startMin - prev.startMin) / 1440;
      if (days < r.preferredSpacingDays) {
        cost += r.weights.spacing * (r.preferredSpacingDays - days);
      }
      const mixed = prev.shift.relaxed || cur.shift.relaxed;
      if (!mixed && (cur.startMin - prev.endMin) / 60 < r.preferredRestHours) cost += r.weights.shortRest;
    }
    return { soft: cost, hard: this.hardViolations(list).length };
  }
}

/**
 * Group surgeons into pools that share the given shifts: two surgeons are in
 * the same pool when they can both cover some service (directly or through
 * colleagues). Each pool gets the shifts of its services.
 */
function pools(surgeons: Surgeon[], shifts: Shift[]): { members: Surgeon[]; shifts: Shift[] }[] {
  const services = new Set(shifts.map((s) => s.serviceId));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const id of services) parent.set(id, id);
  for (const u of surgeons) {
    const mine = u.serviceIds.filter((id) => services.has(id));
    for (const id of mine.slice(1)) parent.set(find(id), find(mine[0]));
  }
  const out = new Map<string, { members: Surgeon[]; shifts: Shift[] }>();
  for (const id of services) if (!out.has(find(id))) out.set(find(id), { members: [], shifts: [] });
  for (const s of shifts) out.get(find(s.serviceId))!.shifts.push(s);
  for (const u of surgeons) {
    const first = u.serviceIds.find((id) => services.has(id));
    if (first) out.get(find(first))!.members.push(u);
  }
  return [...out.values()];
}

/** Does a request's date range (and shift-kind filter) touch this shift? */
export function requestCovers(r: CallRequest, shift: Shift): boolean {
  if (r.shiftKinds?.length && !r.shiftKinds.includes(shift.kind)) return false;
  const from = toMinutes(`${r.startDate}T00:00`);
  const to = toMinutes(`${addDays(r.endDate, 1)}T00:00`);
  return toMinutes(shift.start) < to && toMinutes(shift.end) > from;
}

function insertSorted(list: number[], idx: number): number[] {
  const out = [...list];
  let i = out.length;
  while (i > 0 && out[i - 1] > idx) i--;
  out.splice(i, 0, idx);
  return out;
}

function without(list: number[], idx: number): number[] {
  return list.filter((i) => i !== idx);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function optimizeSchedule(input: OptimizeInput): OptimizeResult {
  const m = new Model(input);
  const rand = mulberry32(input.seed ?? 1);
  const n = m.info.length;

  const owner: (string | null)[] = new Array(n).fill(null);
  const isLocked: boolean[] = new Array(n).fill(false);
  const lists = new Map<string, number[]>();
  for (const u of m.surgeons) lists.set(u.id, []);

  for (const a of input.locked ?? []) {
    const i = m.indexById.get(a.shiftId);
    if (i === undefined || !lists.has(a.userId)) continue;
    owner[i] = a.userId;
    isLocked[i] = true;
    lists.set(a.userId, insertSorted(lists.get(a.userId)!, i));
  }

  const scores = new Map<string, Score>();
  for (const u of m.surgeons) scores.set(u.id, m.score(u.id, lists.get(u.id)!));
  const update = (u: string, list: number[], score: Score) => {
    lists.set(u, list);
    scores.set(u, score);
  };

  /** Give shift i to the cheapest candidate that adds no rule violation. */
  const fill = (i: number) => {
    let best: { u: string; list: number[]; score: Score; delta: number } | null = null;
    for (const u of m.candidates[i]) {
      const list = insertSorted(lists.get(u)!, i);
      const score = m.score(u, list);
      if (score.hard > scores.get(u)!.hard) continue;
      const delta = score.soft - scores.get(u)!.soft;
      if (!best || delta < best.delta) best = { u, list, score, delta };
    }
    if (best) {
      owner[i] = best.u;
      update(best.u, best.list, best.score);
    }
  };

  // 1. Greedy construction: most constrained shifts first.
  [...Array(n).keys()]
    .filter((i) => !isLocked[i])
    .sort((a, b) => m.candidates[a].length - m.candidates[b].length || a - b)
    .forEach(fill);

  // 2. Simulated annealing over reassign and swap moves. Rule violations are
  // cheap early on so the search can pass through them, and become
  // prohibitive by the end.
  const movable = [...Array(n).keys()].filter((i) => !isLocked[i] && m.candidates[i].length > 0);
  const movableByKind = new Map<ShiftKind, number[]>(SHIFT_KINDS.map((k) => [k, []]));
  for (const i of movable) movableByKind.get(m.info[i].shift.kind)!.push(i);
  const iterations = input.iterations ?? Math.max(30_000, movable.length * 100);
  const rampEnd = iterations * 0.8;
  const t0 = 50;
  const t1 = 0.05;
  let penalty = INITIAL_RULE_PENALTY;
  let temp = t0;

  /** Apply a set of shift → owner changes if the annealing criterion accepts them. */
  const tryChanges = (changes: Map<number, string | null>) => {
    const touched = new Map<string, number[]>();
    const get = (u: string) => touched.get(u) ?? lists.get(u)!;
    let delta = 0;
    for (const [i, next] of changes) {
      const prev = owner[i];
      if (prev === next) continue;
      if (prev) touched.set(prev, without(get(prev), i));
      else delta -= UNASSIGNED_PENALTY;
      if (next) touched.set(next, insertSorted(get(next), i));
      else delta += UNASSIGNED_PENALTY;
    }
    const next = new Map<string, Score>();
    for (const [u, list] of touched) {
      const score = m.score(u, list);
      next.set(u, score);
      delta += total(score, penalty) - total(scores.get(u)!, penalty);
    }
    if (delta > 0 && rand() >= Math.exp(-delta / temp)) return;
    for (const [i, u] of changes) owner[i] = u;
    for (const [u, list] of touched) update(u, list, next.get(u)!);
  };

  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  for (let it = 0; it < iterations && movable.length; it++) {
    temp = t0 * (t1 / t0) ** (it / iterations);
    penalty =
      it < rampEnd ? INITIAL_RULE_PENALTY * (HARD_PENALTY / INITIAL_RULE_PENALTY) ** (it / rampEnd) : HARD_PENALTY;
    const i = pick(movable);
    const a = owner[i];

    if (rand() < 0.5 || a === null) {
      // Give shift i to someone else; any of their shifts that now clash are
      // handed on to another candidate (a one-step ejection chain).
      const b = pick(m.candidates[i]);
      if (b === a) continue;
      const changes = new Map<number, string | null>([[i, b]]);
      const clashes = new Set(
        m
          .hardViolations(insertSorted(lists.get(b)!, i))
          .flatMap((v) => v.shiftIds.map((id) => m.indexById.get(id)!))
          .filter((j) => j !== i && !isLocked[j]),
      );
      for (const j of clashes) {
        const others = m.candidates[j].filter((c) => c !== b);
        changes.set(j, others.length ? pick(others) : null);
      }
      tryChanges(changes);
    } else {
      // Swap with a shift of the same kind owned by someone else.
      const j = pick(movableByKind.get(m.info[i].shift.kind)!);
      const b = owner[j];
      if (b === null || b === a) continue;
      if (!m.candidates[i].includes(b) || !m.candidates[j].includes(a)) continue;
      tryChanges(
        new Map([
          [i, b],
          [j, a],
        ]),
      );
    }
  }

  // 3. Repair: drop any shift still breaking a rule, then refill it legally.
  const dropped: number[] = [];
  for (const u of m.surgeons) {
    for (;;) {
      const list = lists.get(u.id)!;
      const offending = m
        .hardViolations(list)
        .flatMap((v) => v.shiftIds.map((id) => m.indexById.get(id)!))
        .filter((i) => !isLocked[i]);
      if (!offending.length) break;
      const i = Math.max(...offending);
      const rest = without(list, i);
      owner[i] = null;
      update(u.id, rest, m.score(u.id, rest));
      dropped.push(i);
    }
  }
  dropped.sort((a, b) => m.candidates[a].length - m.candidates[b].length || a - b).forEach(fill);

  const assignments: Assignment[] = [];
  owner.forEach((u, i) => {
    if (u) assignments.push({ shiftId: m.info[i].shift.id, userId: u, locked: isLocked[i] || undefined });
  });
  const unassigned = owner.flatMap((u, i) => (u ? [] : [m.info[i].shift.id]));
  let cost = unassigned.length * UNASSIGNED_PENALTY;
  for (const s of scores.values()) cost += total(s, HARD_PENALTY);

  return {
    assignments,
    unassignedShiftIds: unassigned,
    cost: Math.round(cost),
    ...analyze(m, input.requests, assignments),
  };
}

/**
 * Check an existing (e.g. hand-edited) schedule against the rules and report
 * per-surgeon stats and request outcomes.
 */
export function evaluateSchedule(
  input: Omit<OptimizeInput, 'locked' | 'seed' | 'iterations'> & { assignments: Assignment[] },
): Omit<OptimizeResult, 'assignments' | 'unassignedShiftIds' | 'cost'> {
  return analyze(new Model(input), input.requests, input.assignments);
}

function analyze(m: Model, requests: CallRequest[], assignments: Assignment[]) {
  const byShift = new Map(assignments.map((a) => [a.shiftId, a.userId]));
  const lists = new Map<string, number[]>();
  for (const u of m.surgeons) lists.set(u.id, []);
  const violations: Violation[] = [];

  m.info.forEach(({ shift }, i) => {
    const u = byShift.get(shift.id);
    if (!u) {
      violations.push({ type: 'unassigned', shiftIds: [shift.id], message: `${shift.id} has no one assigned` });
      return;
    }
    const surgeon = m.surgeonById.get(u);
    if (!surgeon) return;
    lists.get(u)!.push(i);
    const backup = m.backups[shift.serviceId];
    if (!surgeon.serviceIds.includes(shift.serviceId) && !(backup && shift.kind !== 'weekend' && surgeon.serviceIds.includes(backup))) {
      violations.push({
        type: 'ineligible',
        shiftIds: [shift.id],
        userId: u,
        message: `${surgeon.name} is not set up to cover this service`,
      });
    }
  });

  for (const r of requests) {
    if (r.type !== 'unavailable' || r.status !== 'approved') continue;
    for (const i of lists.get(r.userId) ?? []) {
      if (requestCovers(r, m.info[i].shift)) {
        violations.push({
          type: 'unavailable',
          shiftIds: [m.info[i].shift.id],
          userId: r.userId,
          message: `${m.surgeonById.get(r.userId)?.name} has approved time off`,
        });
      }
    }
  }

  const stats: SurgeonStats[] = m.surgeons.map((u) => {
    const list = lists.get(u.id)!;
    for (const v of m.hardViolations(list)) violations.push({ ...v, userId: u.id });
    const counts: Record<ShiftKind, number> = { day: 0, night: 0, weekend: 0 };
    let holidays = 0;
    for (const i of list) {
      counts[m.info[i].shift.kind]++;
      if (m.info[i].shift.holiday) holidays++;
    }
    const t = m.targets.get(u.id)!;
    return {
      userId: u.id,
      name: u.name,
      counts,
      targets: { day: round1(t.day), night: round1(t.night), weekend: round1(t.weekend) },
      holidays,
      holidayTarget: round1(m.holidayTargets.get(u.id)!),
    };
  });

  const requestOutcomes: RequestOutcome[] = requests
    .filter((r) => r.status !== 'denied')
    .map((r) => {
      const hits = (lists.get(r.userId) ?? [])
        .filter((i) => requestCovers(r, m.info[i].shift))
        .map((i) => m.info[i].shift.id);
      return {
        requestId: r.id,
        userId: r.userId,
        type: r.type,
        honored: r.type === 'prefer_on' ? hits.length > 0 : hits.length === 0,
        conflictingShiftIds: r.type === 'prefer_on' ? [] : hits,
      };
    });

  return { stats, requestOutcomes, violations };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
