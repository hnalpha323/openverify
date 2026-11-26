/**
 * `pnpm e2e` (`turbo run e2e`) runs two Playwright suites: the mocked flow suite (apps/flow)
 * and this full-stack suite. Both drive Chromium, and the full-stack selfie specs rely on the
 * in-browser guidance keeping up with a fake-camera clip, so the suites run one after the other
 * (C45.3), never at the same time; the order is in turbo.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './paths.js';

interface TurboTask {
  dependsOn?: string[];
  cache?: boolean;
}

const turbo = JSON.parse(readFileSync(path.join(REPO_ROOT, 'turbo.json'), 'utf8')) as {
  tasks: Record<string, TurboTask | undefined>;
};

describe('the order of the e2e suites in turbo.json', () => {
  it('runs the full-stack suite after the mocked flow suite, with its dependencies built (C45.3)', () => {
    const fullStack = turbo.tasks['@openverify/e2e#e2e'];

    expect(fullStack?.dependsOn).toEqual(
      expect.arrayContaining(['^build', '@openverify/flow#e2e']),
    );
    expect(fullStack?.cache).toBe(false);
  });

  it('keeps the mocked flow suite independent of the full-stack one (no cycle)', () => {
    const flow = turbo.tasks['@openverify/flow#e2e'] ?? turbo.tasks.e2e;

    expect(flow?.dependsOn ?? []).not.toContain('@openverify/e2e#e2e');
    expect(turbo.tasks.e2e?.dependsOn).toEqual(['^build']);
  });
});
