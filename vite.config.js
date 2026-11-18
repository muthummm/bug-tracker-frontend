import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend address for dev and production is set in src/appConfig.js.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001', '/uploads': 'http://localhost:3001' },
  },
});
