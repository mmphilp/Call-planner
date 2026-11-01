import { Linking, Platform } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { API_URL, hasAdminAccess } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function openAdmin() {
  // On the web the console is on the same site and shares the sign-in, so just go there.
  if (Platform.OS === 'web') globalThis.location?.assign('/admin/');
  else Linking.openURL(`${API_URL}/admin/`);
}

/** Link to the admin console for the overall admin, team admins and view-only accounts. */
export function AdminCard() {
  const { user } = useAuth();
  if (!user || !hasAdminAccess(user)) return null;
  const what =
    user.role === 'admin'
      ? 'Build, approve and publish schedules, and manage surgeons and services.'
      : user.role === 'viewer'
        ? 'Schedules, requests, swaps and fairness. Print calendars or export them.'
        : 'Routine days, your team’s weekday call and your team’s swaps.';
  return (
    <Card style={{ gap: 8 }}>
      <T bold>Admin console</T>
      <T muted size={13}>{what}</T>
      <Button label="Open admin console" variant="secondary" onPress={openAdmin} />
    </Card>
  );
}
