import { createContext, useContext } from 'react';
import type { User } from './api';

/** The signed-in admin: the overall admin, or a team admin for some services. */
export const MeContext = createContext<User | null>(null);

export function useMe() {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside MeContext');
  const isSuper = me.role === 'admin';
  return {
    me,
    isSuper,
    /** View-only account (e.g. an assistant): sees everything, changes nothing. */
    isViewer: me.role === 'viewer',
    /** Team admins manage weekday call for their own services; weekends stay with the overall admin. */
    canEditShift: (s: { serviceId: string; kind: string }) =>
      isSuper || (s.kind !== 'weekend' && me.adminServiceIds.includes(s.serviceId)),
    canEditService: (serviceId: string) => isSuper || me.adminServiceIds.includes(serviceId),
  };
}
