import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The release version (root package.json), shown in the console's sidebar.
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Served under /admin/ by the API server; the surgeon app is at the root.
  base: '/admin/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/cal': 'http://localhost:4000' },
  },
});
