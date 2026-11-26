// @ts-check
/**
 * C252.2 (Workflow 11B, ingestion-11b; hardening H16, G-REGEX, BX-D1; ASVS v5.0.0-15.2.2): a regular
 * expression built at run time. Operator or end-user text becomes a pattern only through Phase 9's
 * restricted grammar and linear-time matcher (C148.3: `compilePattern` and `matchPattern` from
 * `@openverify/flow-spec`, inputs capped at `PATTERN_INPUT_LIMIT`), or it is refused at write time.
 * These `no-restricted-syntax` selectors refuse `new RegExp(<anything but a literal>)` and every
 * `RegExp(...)` call, everywhere in the repository, outside the allowlist below: groups of files
 * that never ship (tests, end-to-end support, development scripts) and the reviewed call sites of
 * shipped code, each with its reason and its number of sites (`eslint-operator-patterns.test.ts`
 * fails a reviewed file that gains or loses one, so a new site is reviewed before it lands).
 *
 * `phase5Config()` (`phase5-rules.js`) loads them, so the root `eslint.config.js` needs no line of
 * its own: in the Phase 5 and Workflow 7A folders they join the shared `no-restricted-syntax` list
 * beside the PII log-key selectors, because flat config does not merge one rule's options across
 * config objects (orchestrator decision 21 before Workflow 11B).
 *
 * Honesty (C252.5): a linear-time matcher bounds the cost of one match; the input caps and the rate
 * limits bound the rest. This rule finds patterns built at run time; `String.prototype.match` and
 * `search` given a string also build one, and no route hands them operator text today (inventory
 * 2.8), which this rule does not prove.
 */

export const OPERATOR_PATTERN_MESSAGE =
  'C252: a regular expression built at run time must never hold operator or end-user text. ' +
  'Match such text with compilePattern and matchPattern from @openverify/flow-spec (C148.3) or ' +
  'refuse it at write time; a pattern built only from constants is listed with its reason in ' +
  'packages/config/eslint/operator-patterns.js.';

/** @type {readonly { selector: string; message: string }[]} */
export const OPERATOR_PATTERN_SELECTORS = Object.freeze(
  [
    "NewExpression[callee.name='RegExp']:not([arguments.0.type='Literal'])",
    "NewExpression[callee.property.name='RegExp']:not([arguments.0.type='Literal'])",
    "CallExpression[callee.name='RegExp']",
    "CallExpression[callee.property.name='RegExp']",
  ].map((selector) => Object.freeze({ selector, message: OPERATOR_PATTERN_MESSAGE })),
);

/** Files that never ship, so no operator or end user reaches their patterns. */
/** @type {readonly { globs: readonly string[]; reason: string }[]} */
export const REGEXP_EXEMPT_FILE_GROUPS = Object.freeze([
  {
    globs: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    reason:
      'Tests: their patterns are built from the test’s own constants and synthetic values ' +
      '(escaped labels, ids, fixture text) and run only under Vitest or Playwright, never in a ' +
      'shipped process.',
  },
  {
    globs: ['e2e/**', 'apps/flow/e2e/**', '**/testing/**', '**/test-support/**'],
    reason:
      'End-to-end support and test helpers: route templates, labels and source files of this ' +
      'repository turned into matchers for the suites; never imported by shipped code.',
  },
  {
    globs: ['packages/*/scripts/**'],
    reason:
      'Development scripts (data builders, vector writers, benchmarks) run by a developer over ' +
      'committed data; no image or package ships them.',
  },
]);

/** Reviewed call sites of shipped code: every pattern is built from constants of the code. */
/** @type {readonly { file: string; sites: number; reason: string }[]} */
export const REVIEWED_REGEXP_CALL_SITES = Object.freeze([
  {
    file: 'apps/api/src/config.ts',
    sites: 1,
    reason:
      'A Twilio SID schema: the two-letter prefix is a constant of each caller; the variable’s ' +
      'value is only matched, never compiled.',
  },
  {
    file: 'apps/api/src/operator-auth/totp.ts',
    sites: 1,
    reason: 'The TOTP code shape, built from the constant TOTP_DIGITS.',
  },
  {
    file: 'apps/api/src/vision/schemas.ts',
    sites: 1,
    reason: 'An MRZ line shape, built from the constant MAX_MRZ_LINE_LENGTH.',
  },
  {
    file: 'apps/dashboard/src/components/cases/reviewer/comment-text.tsx',
    sites: 1,
    reason:
      'The mention and id token of a comment, built from the constant ULID body and id ' +
      'prefixes; the comment text is only matched.',
  },
  {
    file: 'apps/dashboard/src/components/flow-builder/branch-routes.tsx',
    sites: 1,
    reason:
      'A JSON pointer prefix built from a step’s list index, a number the code computes; the ' +
      'problem pointers are only matched.',
  },
  {
    file: 'packages/checks/src/data/us-dl-formats.ts',
    sites: 1,
    reason:
      'Driver’s licence number formats written in this file with their citations (shipped ' +
      'data, never operator input).',
  },
  {
    file: 'packages/checks/src/matching/postal-codes.ts',
    sites: 2,
    reason:
      'Postal code formats from the committed matching data (postal-codes.json, written by ' +
      'packages/checks/scripts/build-matching-data.ts), never from an operator or end user.',
  },
  {
    file: 'packages/checks/src/reports/address/us-zip.ts',
    sites: 1,
    reason: 'ZIP prefixes from the committed state table (shipped data, digits only).',
  },
  {
    file: 'packages/config/eslint/logical-properties.js',
    sites: 1,
    reason: 'A lint rule’s utility pattern built from constants; it runs on source at lint time.',
  },
  {
    file: 'packages/contracts/src/case-attachments.ts',
    sites: 1,
    reason: 'An attachment content path built from the constant id body.',
  },
  {
    file: 'packages/contracts/src/cases.ts',
    sites: 1,
    reason: 'A held object’s row key built from the constant id body and prefixes.',
  },
  {
    file: 'packages/contracts/src/connect.ts',
    sites: 1,
    reason: 'The peek path grammar built from the constant subtype lists (C233.2).',
  },
  {
    file: 'packages/contracts/src/handoffs.ts',
    sites: 1,
    reason: 'The handoff URL fragment built from the constant id body and token prefix.',
  },
  {
    file: 'packages/contracts/src/ids.ts',
    sites: 4,
    reason: 'Public id shapes built from the constant ULID body and the closed prefix table (C1).',
  },
  {
    file: 'packages/contracts/src/origin-pattern.ts',
    sites: 2,
    reason:
      'The embed origin grammar built from a constant label expression; an operator’s entry is ' +
      'parsed by it, never compiled.',
  },
  {
    file: 'packages/contracts/src/recovery-codes.ts',
    sites: 2,
    reason: 'The recovery code shape built from constant groups and its constant length.',
  },
  {
    file: 'packages/contracts/src/theme-sets.ts',
    sites: 1,
    reason: 'A theme set revision id built from the constant id body.',
  },
  {
    file: 'packages/contracts/src/tokens.ts',
    sites: 1,
    reason: 'Bearer token shapes built from each token kind’s constant prefix and body.',
  },
  {
    file: 'packages/contracts/src/transactions.ts',
    sites: 2,
    reason: 'A relation’s row key and cursor built from constant key and target expressions.',
  },
  {
    file: 'packages/core/src/cases/search.ts',
    sites: 1,
    reason: 'Id shapes for the case search filters, built from constant prefixes.',
  },
  {
    file: 'packages/core/src/tags.ts',
    sites: 1,
    reason: 'The tag format built from the constant MAX_TAG_LENGTH (C9).',
  },
  {
    file: 'packages/core/src/transactions/fields-validator.ts',
    sites: 2,
    reason: 'File and verification id shapes built from the constant ULID body.',
  },
  {
    file: 'packages/db/src/repositories/subject-ids.ts',
    sites: 1,
    reason: 'Subject id search built from the constant REDACTION_SUBJECT_ID_PREFIXES.',
  },
  {
    file: 'packages/flow-spec/src/v2/schemas/common.ts',
    sites: 1,
    reason: 'publicIdSchema(prefix): every caller passes a constant id prefix.',
  },
  {
    file: 'packages/node/src/webhook-signature.ts',
    sites: 1,
    reason: 'The signature header shape built from the constant MAX_SIGNATURES.',
  },
  {
    file: 'packages/node/src/workflow-request-signature.ts',
    sites: 1,
    reason: 'The request signature header shape built from the constant MAX_SIGNATURES.',
  },
  {
    file: 'packages/sdk-js/src/frame-url.ts',
    sites: 2,
    reason: 'Session and one-time token shapes built from constant prefixes and the token body.',
  },
]);

/**
 * Every glob and file the run-time pattern selectors skip, in the order the two lists hold them.
 * @returns {string[]}
 */
export function regexpAllowlistGlobs() {
  return [
    ...REGEXP_EXEMPT_FILE_GROUPS.flatMap((group) => group.globs),
    ...REVIEWED_REGEXP_CALL_SITES.map((entry) => entry.file),
  ];
}
