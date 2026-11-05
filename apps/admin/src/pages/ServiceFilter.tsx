import { useEffect, useState, type ReactNode } from 'react';
import { get, type Hospital, type Schedule } from '../api';

type Service = Schedule['services'][number];

// Shared by the Calendar, Weekdays and Weekends views; remembered per browser.
const HIDDEN_KEY = 'call-planner-calendar-hidden-services';

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function save(hidden: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    /* storage unavailable: the filter just isn't remembered */
  }
}

export interface ServiceFilterState {
  hidden: Set<string>;
  toggle: (id: string) => void;
  showAll: () => void;
  /** Show only these services. */
  only: (ids: string[], all: string[]) => void;
}

/** The hospitals list, fetched once per page load. */
let hospitalsCache: Promise<Hospital[]> | null = null;
function useHospitals() {
  const [hs, setHs] = useState<Hospital[]>([]);
  useEffect(() => {
    hospitalsCache ??= get<Hospital[]>('/api/hospitals').catch(() => []);
    hospitalsCache.then(setHs);
  }, []);
  return hs;
}

/** Does a service cover this hospital? (None listed = all.) */
export const atHospital = (s: { hospitalIds?: string[] }, hospitalId: string) => !s.hospitalIds?.length || s.hospitalIds.includes(hospitalId);

export function useServiceFilter(): ServiceFilterState {
  const [hidden, setHidden] = useState(load);
  const update = (next: Set<string>) => {
    setHidden(next);
    save(next);
  };
  return {
    hidden,
    toggle: (id) => {
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      update(next);
    },
    showAll: () => update(new Set()),
    only: (ids, all) => update(new Set(all.filter((id) => !ids.includes(id)))),
  };
}

/** Alphabetical, with weekend-block services after the weekday teams. */
export function sortServices<T extends Service>(services: T[]): T[] {
  return [...services].sort(
    (a, b) => Number(a.coversWeekend) - Number(b.coversWeekend) || a.name.localeCompare(b.name),
  );
}

/** "Show: ☑ Colorectal ☑ Endocrine …" checkboxes. */
export function ServiceFilter({
  services,
  filter,
  children,
}: {
  services: Service[];
  filter: ServiceFilterState;
  children?: ReactNode;
}) {
  const { hidden, toggle, showAll, only } = filter;
  const hospitals = useHospitals();
  // Quick picks: every service at one hospital (services covering all hospitals included).
  const picks = hospitals.filter((h) => services.some((s) => s.hospitalIds?.includes(h.id)));
  return (
    <div className="row small cal-filter" style={{ marginBottom: 8, gap: 14 }}>
      {picks.length > 0 && (
        <span className="row no-print" style={{ gap: 6 }}>
          <span className="muted">Hospital:</span>
          {picks.map((h) => {
            const ids = services.filter((s) => atHospital(s, h.id)).map((s) => s.id);
            const active = services.every((s) => hidden.has(s.id) !== ids.includes(s.id));
            return (
              <button
                key={h.id}
                className={active ? 'primary' : ''}
                style={{ padding: '2px 8px' }}
                title={`Only services at ${h.name}`}
                onClick={() => (active ? showAll() : only(ids, services.map((s) => s.id)))}
              >
                {h.shortName || h.name}
              </button>
            );
          })}
        </span>
      )}
      <span className="muted no-print">Show:</span>
      {services.map((s) => (
        <label key={s.id} className={`check ${hidden.has(s.id) ? 'off' : ''}`}>
          <input type="checkbox" className="no-print" checked={!hidden.has(s.id)} onChange={() => toggle(s.id)} />
          <span className="svc-dot" style={{ background: s.color }} />
          {s.name}
        </label>
      ))}
      {services.some((s) => hidden.has(s.id)) && (
        <button className="link no-print" onClick={showAll}>
          Show all
        </button>
      )}
      {children}
    </div>
  );
}
