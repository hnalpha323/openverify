/**
 * Axe on every Phase 8 console page (C141.8, C142.6; Workflow 8D Stage 1, `platform-carry`).
 *
 * `expectNoAxeViolations(page, where)` runs axe-core (through `@axe-core/playwright`, MPL-2.0
 * test tooling, THIRD_PARTY_LICENSES.md section 5) on the page as it stands, with the WCAG 2.0,
 * 2.1 and 2.2 A and AA tags, and fails with one line per violation and target: the rule id, its
 * impact, the target and axe's help text. It never disables a rule or excludes an element: a
 * violation is fixed where it lives, never hidden here.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { AXE_WCAG_TAGS, axeViolationLines } from '../../src/axe.js';

/** Runs axe on `page` now; `where` names the page in the failure (for example "/workflows"). */
export async function expectNoAxeViolations(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_WCAG_TAGS]).analyze();
  expect(axeViolationLines(results.violations), `axe violations on ${where}`).toEqual([]);
}
