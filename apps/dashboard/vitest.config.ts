import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVitestConfig } from '@openverify/config/vitest';

// Next.js resolves `server-only` to its empty module on the server (the `react-server`
// condition) and fails the build when a client bundle imports it. Tests run server modules
// directly, so they get the same empty module. Its `exports` hide `empty.js`, so it is
// located next to the package's entry point.
const serverOnlyEmpty = join(
  dirname(fileURLToPath(import.meta.resolve('server-only'))),
  'empty.js',
);

export default createVitestConfig({
  resolve: { alias: { 'server-only': serverOnlyEmpty } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // The custom Node server (C21) lives beside next.config.ts, outside src/.
    include: ['server.test.ts'],
    coverage: { include: ['server.ts'] },
  },
});
