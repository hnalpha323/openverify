/**
 * Axe on the console pages (C141.8, C142.6; Workflow 8D Stage 1): the tags axe runs with, the
 * report a failing spec prints, and the licence rule that keeps axe (MPL-2.0) in e2e alone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AXE_WCAG_TAGS, axeViolationLines, type AxeViolation } from './axe.js';
import { REPO_ROOT } from './paths.js';

describe('the WCAG tags axe runs with', () => {
  it('are the WCAG 2.0, 2.1 and 2.2 A and AA tags axe-core 4.14 knows, and no AAA or best-practice tag', () => {
    expect([...AXE_WCAG_TAGS].sort()).toEqual([
      'wcag21a',
      'wcag21aa',
      'wcag22aa',
      'wcag2a',
      'wcag2aa',
    ]);
  });
});

describe('the lines a failing spec prints', () => {
  const violation = (overrides: Partial<AxeViolation>): AxeViolation => ({
    id: 'button-name',
    impact: 'critical',
    help: 'Buttons must have discernible text',
    nodes: [{ target: ['#zoom-in'] }],
    ...overrides,
  });

  it('names nothing when axe found nothing', () => {
    expect(axeViolationLines([])).toEqual([]);
  });

  it('names each violation by rule id, impact, help and target, one line per target', () => {
    expect(
      axeViolationLines([
        violation({
          nodes: [{ target: ['#zoom-in'] }, { target: ['main > button:nth-child(2)'] }],
        }),
        violation({
          id: 'color-contrast',
          impact: 'serious',
          help: 'Elements must meet minimum color contrast ratio thresholds',
          nodes: [{ target: ['.badge'] }],
        }),
      ]),
    ).toEqual([
      'button-name (critical) at #zoom-in: Buttons must have discernible text',
      'button-name (critical) at main > button:nth-child(2): Buttons must have discernible text',
      'color-contrast (serious) at .badge: Elements must meet minimum color contrast ratio thresholds',
    ]);
  });

  it('joins a target inside a frame or a shadow root, and says when axe gave no impact', () => {
    expect(
      axeViolationLines([
        violation({ impact: null, nodes: [{ target: ['iframe', ['my-host', 'button']] }] }),
        violation({ impact: undefined, nodes: [] }),
      ]),
    ).toEqual([
      'button-name (impact not given) at iframe >>> my-host >>> button: Buttons must have discernible text',
      'button-name (impact not given) at (no target): Buttons must have discernible text',
    ]);
  });
});

describe('axe-core stays test tooling (CLAUDE.md rule 4, THIRD_PARTY_LICENSES.md section 5)', () => {
  // Phase 9 (C171.2, Workflow 9A Stage 1a): the mocked flow suite runs axe too, so apps/flow
  // joins e2e as the second importer allowed. Its devDependency is never bundled into the flow.
  it('is a dependency of the e2e package and the flow app alone in the lockfile', () => {
    const lockfile = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    // pnpm 12 writes its own environment as a first YAML document; the workspace's is the last.
    const start = lockfile.lastIndexOf('\nimporters:\n');
    const importers = lockfile.slice(start, lockfile.indexOf('\npackages:\n', start));
    const dependents = new Set<string>();
    let importer = '';
    for (const line of importers.split('\n')) {
      const name = /^ {2}(\S[^:]*):$/u.exec(line);
      if (name?.[1] !== undefined) {
        importer = name[1];
      } else if (/^ {6}'?(@axe-core\/[^:']+|axe-core)'?:$/u.test(line)) {
        dependents.add(importer);
      }
    }

    expect(importers.length).toBeGreaterThan(0);
    expect([...dependents].sort()).toEqual(['apps/flow', 'e2e']);
  });
});
