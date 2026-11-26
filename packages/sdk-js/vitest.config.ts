import { createVitestConfig } from '@openverify/config/vitest';

// The client's tests mount iframes and exchange messages with them, so they run in jsdom.
export default createVitestConfig({ test: { environment: 'jsdom' } });
