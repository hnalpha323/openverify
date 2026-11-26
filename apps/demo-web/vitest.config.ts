import { createVitestConfig } from '@openverify/config/vitest';

// The sample's page renders in jsdom; its server's tests run in Node (by their docblock). The two
// entry points only start what the tested modules build.
export default createVitestConfig({
  test: {
    environment: 'jsdom',
    coverage: { exclude: ['src/server/main.ts', 'src/page/main.tsx'] },
  },
});
