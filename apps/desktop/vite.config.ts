import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { portableBundleAudit } from '../../scripts/portable-bundle-audit.mjs';

export default defineConfig({
  // A local candidate must not load managed-service credentials from .env files.
  ...(process.env.PDFRIG_PORTABLE_AUDIT_OUTPUT ? { envDir: false as const } : {}),
  build: {
    sourcemap: true,
  },
  clearScreen: false,
  plugins: [
    react(),
    ...(process.env.PDFRIG_PORTABLE_AUDIT_OUTPUT
      ? [portableBundleAudit(process.env.PDFRIG_PORTABLE_AUDIT_OUTPUT)]
      : []),
  ],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
});
