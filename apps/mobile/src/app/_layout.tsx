import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { AuthProvider } from '@/lib/auth';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="trade" options={{ presentation: 'modal', headerShown: true, title: 'Swap or give away' }} />
          <Stack.Screen
            name="new-request"
            options={{ presentation: 'modal', headerShown: true, title: 'New request' }}
          />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
