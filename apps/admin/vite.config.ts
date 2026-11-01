import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Served under /admin/ by the API server; the surgeon app is at the root.
  base: '/admin/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/cal': 'http://localhost:4000' },
  },
});
