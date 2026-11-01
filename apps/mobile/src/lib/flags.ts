import type { Flag } from './api';

export const FLAG_STATUS: Record<Flag['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  open: { label: 'Sent to scheduler', tone: 'warn' },
  fixed: { label: 'Fixed', tone: 'ok' },
  no_change: { label: 'No change', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
