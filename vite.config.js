import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, calls to /api and /uploads go to the backend running on port 3001,
// so VITE_API_URL can stay empty locally. In production set VITE_API_URL to the backend's address.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001', '/uploads': 'http://localhost:3001' },
  },
});
