import { createVitestConfig } from '@openverify/config/vitest';

// The bindings render in jsdom (React Testing Library). The release's pack tool lives in `scripts/`
// with its own tests (which run in Node, by their docblock), and is held to the same 80% gate.
export default createVitestConfig({
  test: {
    environment: 'jsdom',
    include: ['scripts/**/*.test.ts'],
    coverage: { include: ['scripts/**/*.ts'], exclude: ['scripts/**/*.test.ts'] },
  },
});
