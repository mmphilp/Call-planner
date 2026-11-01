import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { AdminCard } from '@/components/AdminCard';
import { Button, Card, Screen, SectionHeader, T } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/lib/dialogs';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  const feedUrl = user.calendarPath ? `${API_URL}${user.calendarPath}` : null;
  const webcal = feedUrl?.replace(/^https?:/, 'webcal:');

  const subscribe = async () => {
    if (!webcal || !feedUrl) return;
    try {
      await Linking.openURL(webcal);
    } catch {
      await Clipboard.setStringAsync(feedUrl);
      notify(
        'Link copied',
        'Paste it into your calendar app as a subscription (Google Calendar: Other calendars → From URL).',
      );
    }
  };

  return (
    <Screen title="Profile">
      <Card style={{ gap: 4 }}>
        <T bold size={18}>{user.name}</T>
        <T muted>{user.email}</T>
        {user.phone ? <T muted>{user.phone}</T> : null}
      </Card>

      <AdminCard />

      <SectionHeader>Calendar sync</SectionHeader>
      <Card style={{ gap: 10 }}>
        <T>Add your published call to your phone’s calendar. It updates automatically when the schedule changes.</T>
        <Button label="Subscribe in Calendar" onPress={subscribe} disabled={!feedUrl} />
        <Button
          label="Copy calendar link"
          variant="secondary"
          disabled={!feedUrl}
          onPress={async () => {
            if (feedUrl) await Clipboard.setStringAsync(feedUrl);
            notify('Copied', 'Keep this link private. Anyone with it can see your call schedule.');
          }}
        />
      </Card>

      <View style={{ marginTop: 16, gap: 10 }}>
        <Button label="Change password" variant="secondary" onPress={() => router.push('/change-password')} />
        <Button label="Sign out" variant="danger" onPress={signOut} />
      </View>
    </Screen>
  );
}
