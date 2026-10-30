import type { ConfigContext, ExpoConfig } from 'expo/config';

// EXPO_BASE_URL=/app serves the web build from a sub-path (see the Dockerfile).
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
