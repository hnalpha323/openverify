import { createVitestConfig } from '@openverify/config/vitest';

export default createVitestConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
