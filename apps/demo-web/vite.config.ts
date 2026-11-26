import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * The sample page's build. Workspace packages are bundled from their TypeScript source, as the
 * flow's are. In development (`vite`), `/api` and `/webhooks` go to the sample's own server
 * (`pnpm --filter @openverify/demo-web start`, 127.0.0.1:4180 by default).
 */
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@openverify/source', ...defaultClientConditions] },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://127.0.0.1:4180', '/webhooks': 'http://127.0.0.1:4180' },
  },
});
