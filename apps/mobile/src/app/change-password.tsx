import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { Button, Card, ErrorText, T } from '@/components/ui';
import { api, type User } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/lib/dialogs';
import { useTheme } from '@/lib/theme';

/**
 * Choose a new password. Required (no way back) after signing in with a
 * temporary password — a new account, or one the admin reset; otherwise
 * opened from Profile.
 */
export default function ChangePasswordScreen() {
  const t = useTheme();
  const { user, setUser, signOut } = useAuth();
  const forced = !!user?.mustChangePassword;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (next.length < 8) return setError('Use at least 8 characters.');
    if (next !== again) return setError('The new passwords don’t match.');
    setBusy(true);
    try {
      const u = await api<User>('POST', '/api/me/password', { current, next });
      // Keep the calendar link etc. from /api/me.
      setUser({ ...user!, ...u, mustChangePassword: false });
      notify('Password changed', forced ? 'You’re all set.' : 'Use it next time you sign in.');
      if (forced) router.replace('/');
      else router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, color: t.text, backgroundColor: t.card, borderColor: t.border };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
      {/* Required: no back button or swipe-to-dismiss. */}
      <Stack.Screen options={{ title: forced ? 'Choose a new password' : 'Change password', headerBackVisible: !forced, gestureEnabled: !forced }} />
      {forced && (
        <Card style={{ gap: 4, borderColor: t.warn }}>
          <T bold>Choose your own password</T>
          <T muted size={13}>You signed in with a temporary password. Pick a new one to continue.</T>
        </Card>
      )}
      <ErrorText message={error} />
      <T muted size={13}>{forced ? 'Temporary password' : 'Current password'}</T>
      <TextInput style={input} secureTextEntry autoComplete="current-password" textContentType="password" value={current} onChangeText={setCurrent} />
      <T muted size={13}>New password (at least 8 characters)</T>
      <TextInput style={input} secureTextEntry autoComplete="new-password" textContentType="newPassword" value={next} onChangeText={setNext} />
      <T muted size={13}>New password again</T>
      <TextInput
        style={input}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={again}
        onChangeText={setAgain}
        onSubmitEditing={submit}
      />
      <Button label="Change password" onPress={submit} busy={busy} disabled={!current || !next || !again} />
      {forced && <Button label="Sign out" variant="secondary" onPress={signOut} />}
    </ScrollView>
  );
}
