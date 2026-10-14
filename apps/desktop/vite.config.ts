import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: true,
  },
  clearScreen: false,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
});
