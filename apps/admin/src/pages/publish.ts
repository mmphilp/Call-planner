import type { PeriodData } from './Period';

/** Services with shifts in this schedule, and how many are already published on their own. */
export function servicesPublished(data: PeriodData) {
  const p = data.schedule.period;
  const inSchedule = data.schedule.services.filter((s) => data.schedule.shifts.some((x) => x.serviceId === s.id));
  const published = inSchedule.filter((s) => p.status === 'published' || p.publishedServiceIds?.includes(s.id));
  return { total: inSchedule.length, published };
}

/**
 * The confirm question before publishing the whole schedule: what's still
 * unfinished (unfilled shifts, rule problems, open flags), and which services
 * this publishes beyond those already out.
 */
export function publishQuestion(data: PeriodData) {
  const assigned = data.schedule.assignments.length;
  const total = data.schedule.shifts.filter((s) => !s.coveredBy).length;
  const ruleBreaks = data.report.violations.filter((v) => v.type !== 'unassigned').length;
  const openFlags = data.flags.filter((f) => f.status === 'open').length;
  const problems = [
    total - assigned && `${total - assigned} shift${total - assigned === 1 ? ' is' : 's are'} unfilled`,
    ruleBreaks && `${ruleBreaks} rule problem${ruleBreaks === 1 ? ' remains' : 's remain'}`,
    openFlags && `${openFlags} flag${openFlags === 1 ? '' : 's'} from surgeons ${openFlags === 1 ? 'is' : 'are'} still open`,
  ].filter(Boolean);
  const { published } = servicesPublished(data);
  const rest = published.length ? ` This publishes every service, including the ones not published yet.` : '';
  return problems.length ? `${problems.join(', ')}. Publish the whole schedule anyway?${rest}` : `Publish the whole schedule as final?${rest}`;
}
