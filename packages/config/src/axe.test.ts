/**
 * C171.2 (Workflow 9A Stage 1b (A11Y)): the pure half of the accessibility helpers both Playwright
 * suites share (`expectAccessible` in `apps/flow/e2e/support/` and `e2e/tests/support/`, and
 * Workflow 8D's `expectNoAxeViolations`): one tag list, one report line per violation, and the
 * exceptions of `e2e/a11y-exceptions.json`, each with a reason and an expiry date.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AXE_WCAG_TAGS,
  A11Y_EXCEPTIONS_PATH,
  applyA11yExceptions,
  axeIncompleteSummary,
  axeViolationLines,
  parseA11yExceptions,
  type AxeViolation,
} from './axe.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const NOW = new Date('2026-11-05T12:00:00Z');

const violation = (overrides: Partial<AxeViolation> = {}): AxeViolation => ({
  id: 'image-alt',
  impact: 'critical',
  help: 'Images must have alternate text',
  nodes: [{ target: ['img.logo'] }],
  ...overrides,
});

describe('the one tag list (C171.2)', () => {
  it('is WCAG 2.0, 2.1 and 2.2 A and AA, without wcag22a, which axe-core 4.14 gives no rule', () => {
    expect(AXE_WCAG_TAGS).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  });

  it('reports one line per violation and target', () => {
    expect(axeViolationLines([violation()])).toEqual([
      'image-alt (critical) at img.logo: Images must have alternate text',
    ]);
  });
});

describe('the exceptions file (C171.2)', () => {
  it('exists at the repository root of e2e, empty at first', () => {
    const file = path.join(repoRoot, A11Y_EXCEPTIONS_PATH);
    const parsed = parseA11yExceptions(JSON.parse(readFileSync(file, 'utf8')) as unknown);

    expect(A11Y_EXCEPTIONS_PATH).toBe('e2e/a11y-exceptions.json');
    expect(parsed).toEqual([]);
  });

  it('takes an exception only with a rule, a reason and a valid expiry date, and nothing else', () => {
    const exception = {
      rule: 'color-contrast',
      target: '.badge',
      where: '/workflows',
      reason: 'The tracking item for the badge palette.',
      expires: '2026-12-31',
    };

    expect(parseA11yExceptions({ exceptions: [exception] })).toEqual([exception]);
    for (const refused of [
      { ...exception, reason: '' },
      { ...exception, expires: '2026-02-30' },
      { ...exception, expires: '31/12/2026' },
      { ...exception, rule: '' },
      { ...exception, disabled: true },
      { rule: 'color-contrast', expires: '2026-12-31' },
    ]) {
      expect(() => parseA11yExceptions({ exceptions: [refused] }), JSON.stringify(refused)).toThrow(
        /a11y-exceptions/,
      );
    }
    expect(() => parseA11yExceptions({ exceptions: [], extra: 1 })).toThrow(/a11y-exceptions/);
    expect(() => parseA11yExceptions([])).toThrow(/a11y-exceptions/);
  });

  it('lets an unexpired exception pass its rule at its target and page, and nothing else', () => {
    const exception = {
      rule: 'image-alt',
      target: 'img.logo',
      where: '/consent',
      reason: 'Synthetic tracking item.',
      expires: '2026-12-31',
    };
    const other = violation({ nodes: [{ target: ['img.other'] }] });

    expect(
      applyA11yExceptions([violation(), other], [exception], { now: NOW, where: '/consent' }),
    ).toEqual({ violations: [other], expired: [] });
    expect(
      applyA11yExceptions([violation()], [exception], { now: NOW, where: '/selfie' }).violations,
    ).toEqual([violation()]);
    expect(
      applyA11yExceptions([violation()], [{ ...exception, target: undefined, where: undefined }], {
        now: NOW,
        where: '/selfie',
      }).violations,
    ).toEqual([]);
  });

  it('fails an expired exception, whether or not it still matches, naming it and its reason', () => {
    const expired = {
      rule: 'image-alt',
      reason: 'Synthetic tracking item.',
      expires: '2026-11-04',
    };

    expect(applyA11yExceptions([violation()], [expired], { now: NOW, where: '/' })).toEqual({
      violations: [violation()],
      expired: ['the exception for image-alt expired on 2026-11-04: Synthetic tracking item.'],
    });
    expect(
      applyA11yExceptions([], [{ ...expired, expires: '2026-11-05' }], { now: NOW, where: '/' })
        .expired,
    ).toEqual([]);
  });
});

describe('the incomplete results (C171.2)', () => {
  it('keep each rule, impact and target for the manual pass, never the HTML', () => {
    const node = { target: ['p.hint'], html: '<p class="hint">Synthetic</p>' };
    const incomplete = { ...violation({ id: 'color-contrast', impact: 'serious' }), nodes: [node] };

    expect(axeIncompleteSummary([incomplete])).toEqual([
      { rule: 'color-contrast', impact: 'serious', targets: ['p.hint'] },
    ]);
  });
});
