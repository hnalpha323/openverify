import { describe, expect, it } from 'vitest';
import { demoWebBuildArgs } from './demo-web.js';

describe('the sample site in the stack (C266.3)', () => {
  it("builds apps/demo-web with Vite into the run's artifacts, never into its own dist", () => {
    expect(demoWebBuildArgs('/repo/e2e/.artifacts/demo-web')).toEqual([
      'exec',
      'vite',
      'build',
      '--outDir',
      '/repo/e2e/.artifacts/demo-web',
      '--emptyOutDir',
      '--logLevel',
      'warn',
    ]);
  });
});
