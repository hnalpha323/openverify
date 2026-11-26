/**
 * The full-stack Playwright config. Workflow 4A Stage 4 (`integration`) removed Stage 1's e2e
 * exclusion of the five selfie specs (docs/plans/phase-4.plan.md, "The e2e exclusion"): every
 * spec under tests/ runs. Chromium's fake camera is process-wide, so each clip needs its own
 * browser launch (C45.3): one worker, one spec at a time.
 */
import { describe, expect, it } from 'vitest';
import config from '../playwright.config.js';

describe('the full-stack Playwright config', () => {
  it('runs every spec under tests/, ignoring none (C45.3)', () => {
    expect(config.testDir).toBe('./tests');
    expect(config.testIgnore ?? []).toEqual([]);
  });

  it('runs one browser at a time, so each fake-camera clip has its own launch (C45.3)', () => {
    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBe(false);
  });

  it('runs the console sweep as its own project, after the chromium specs (Workflow 9C; C170.3, C171.2)', () => {
    const projects = config.projects ?? [];
    expect(projects.map((project) => project.name)).toEqual(['chromium', 'console-sweep']);
    const [chromium, sweep] = projects;
    expect(chromium?.testIgnore).toEqual(['**/a11y-console.spec.ts', '**/ui-csp.spec.ts']);
    expect(sweep?.testMatch).toEqual(['**/a11y-console.spec.ts', '**/ui-csp.spec.ts']);
    expect(sweep?.dependencies).toEqual(['chromium']);
  });
});
