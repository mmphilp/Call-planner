import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function LoginScreen() {
  const { user, signIn } = useAuth();
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportEmail, setSupportEmail] = useState<string | null>(null);

  useEffect(() => {
    api<{ supportEmail: string | null }>('GET', '/api/info')
      .then((i) => setSupportEmail(i.supportEmail))
      .catch(() => {});
  }, []);

  if (user) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={{ gap: 6, marginBottom: 24 }}>
          <View style={styles.logo}>
            <Image source={require('@/assets/images/logo-mark.png')} style={{ width: 52, height: 52 }} resizeMode="contain" />
          </View>
          <Text style={[styles.title, { color: t.text }]}>Call Planner</Text>
          <Text style={{ color: t.muted, fontSize: 16 }}>See your call schedule and send requests.</Text>
        </View>
        <ErrorText message={error} />
        <TextInput
          style={input}
          placeholder="Email"
          placeholderTextColor={t.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={input}
          placeholder="Password"
          placeholderTextColor={t.muted}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        <Button label="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
        <Text style={{ color: t.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          Your scheduler sets up your account.{' '}
          {supportEmail ? (
            <>
              Can’t sign in? Email{' '}
              <Text style={{ color: t.accent }} onPress={() => Linking.openURL(`mailto:${supportEmail}`)}>
                {supportEmail}
              </Text>
            </>
          ) : (
            'Ask them if you can’t sign in.'
          )}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Narrow column, centered, so it reads well on an iPad or a computer too.
  wrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 34, fontWeight: '700' },
  // Brand tile: the white mark on the logo's cherry red, in both themes.
  logo: { width: 72, height: 72, borderRadius: 16, backgroundColor: '#90021e', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
});
