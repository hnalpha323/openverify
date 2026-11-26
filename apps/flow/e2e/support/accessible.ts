/**
 * C171.2 (Workflow 9A Stage 1b (A11Y)): `expectAccessible(page, { include?, exclude? })` for the
 * mocked flow suite, called at each state of each step. It runs axe-core (through
 * `@axe-core/playwright`, MPL-2.0 test tooling, THIRD_PARTY_LICENSES.md section 5) with the one
 * WCAG tag list of `@openverify/config/axe`, fails on any violation by rule, impact and target
 * (after the unexpired exceptions of `e2e/a11y-exceptions.json`, and on any expired one), and
 * attaches the incomplete results (rule, impact and targets, never the HTML) for the manual pass.
 * `e2e/tests/support/accessible.ts` is the full-stack suite's twin.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import {
  A11Y_EXCEPTIONS_PATH,
  AXE_WCAG_TAGS,
  applyA11yExceptions,
  axeIncompleteSummary,
  axeViolationLines,
  parseA11yExceptions,
  type A11yException,
} from '@openverify/config/axe';
import { expect, test, type Page } from '@playwright/test';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export interface ExpectAccessibleOptions {
  /** Only these (a selector or several) are checked. */
  readonly include?: string | readonly string[];
  /** These are not checked. */
  readonly exclude?: string | readonly string[];
  /** The page or state in the failure and in an exception's `where`; defaults to the path. */
  readonly where?: string;
  /** Replaces the exceptions file (tests of this helper). */
  readonly exceptions?: readonly A11yException[];
}

const listOf = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

/** Runs axe on `page` now and fails on any violation an exception does not pass. */
export async function expectAccessible(
  page: Page,
  options: ExpectAccessibleOptions = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...AXE_WCAG_TAGS]);
  for (const selector of listOf(options.include)) {
    builder = builder.include(selector);
  }
  for (const selector of listOf(options.exclude)) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();
  const where = options.where ?? new URL(page.url()).pathname;
  const exceptions =
    options.exceptions ??
    parseA11yExceptions(
      JSON.parse(readFileSync(`${REPO_ROOT}${A11Y_EXCEPTIONS_PATH}`, 'utf8')) as unknown,
    );
  const { violations, expired } = applyA11yExceptions(results.violations, exceptions, {
    now: new Date(),
    where,
  });
  await test.info().attach('axe-incomplete', {
    body: JSON.stringify({ where, incomplete: axeIncompleteSummary(results.incomplete) }, null, 2),
    contentType: 'application/json',
  });
  expect([...expired, ...axeViolationLines(violations)], `accessibility of ${where}`).toEqual([]);
}
