import react from '@vitejs/plugin-react';
import { createVitestConfig } from '@openverify/config/vitest';

export default createVitestConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // main.tsx only wires the browser globals into <App />; it is exercised by the e2e smoke test.
    coverage: { exclude: ['src/main.tsx'] },
  },
});
