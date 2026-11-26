/**
 * Axe on the console pages (C141.8, C142.6; Workflow 8D Stage 1). The pure half of
 * `tests/support/ui-axe.ts` and `tests/support/accessible.ts`: the WCAG tags axe runs with and one
 * line per violation. Since Workflow 9A Stage 1b (A11Y) it lives in `@openverify/config/axe`, which
 * the mocked flow suite shares, so there is one tag list; this module keeps the e2e import path.
 */
export { AXE_WCAG_TAGS, axeViolationLines, type AxeViolation } from '@openverify/config/axe';
