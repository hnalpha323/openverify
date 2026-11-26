// @vitest-environment node
/**
 * C94.1 (client-collector's deviation, Workflow 7A): the flow imports the browser collector as the
 * workspace package `@openverify/signals/browser`, declared in its dependencies, rather than by a
 * path into another package's sources.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('the flow’s collector dependency (C94.1)', () => {
  it('is declared as the workspace package', () => {
    const manifest = JSON.parse(read('../../package.json')) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.['@openverify/signals']).toBe('workspace:*');
  });

  it('is imported through the package’s browser entry', () => {
    const source = read('./collector.ts');

    expect(source).toContain("from '@openverify/signals/browser'");
    expect(source).not.toContain('packages/signals/src');
  });
});
