import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { api } from '@/lib/api';

/**
 * A strip across the top on a second copy of the site (e.g. "Test copy"),
 * so it can't be mistaken for the real one. Web only: the phone apps always
 * point at the real server.
 */
export function InstanceBanner() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    api<{ instanceLabel: string | null }>('GET', '/api/info')
      .then((i) => setLabel(i.instanceLabel))
      .catch(() => {});
  }, []);
  if (!label) return null;
  return (
    <View style={{ backgroundColor: '#b45309', paddingVertical: 3, paddingHorizontal: 8 }}>
      <Text style={{ color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: '600' }}>
        {label} — changes here don’t affect the real schedule
      </Text>
    </View>
  );
}
