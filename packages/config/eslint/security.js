// @ts-check
/**
 * C260.1 (Workflow 11C, sast-pii-11c; decision 2, review F28, OD-11C-1): the SAST baseline.
 *
 * eslint-plugin-security 4.2.0's rules, each on or off with its reason. `phase5Config()`
 * (`phase5-rules.js`) spreads `securityConfig()`, and the root `eslint.config.js` spreads
 * `phase5Config()`, so the rules run in `pnpm lint` and CI's lint job; the root file is not edited
 * (rule 26). Semgrep's engine, its rules and Opengrep fail CLAUDE.md rule 4; CodeQL waits for Q9;
 * eslint-plugin-no-unsanitized (MPL-2.0) is not adopted, and a source test keeps every non-test
 * module from writing HTML through the DOM (C260.2).
 *
 * A finding is fixed, or suppressed on its line by a disable-next-line comment that names the rule
 * and gives the reason after ` -- `; `packages/config/src/eslint-security.test.ts` counts them per rule
 * against {@link SECURITY_SUPPRESSION_CEILING}, and raising a ceiling needs its reason in the
 * commit. A clean lint means these patterns found nothing, not a security review (C259.5).
 */

import security from 'eslint-plugin-security';

const SOURCE_FILES = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'];

/**
 * Every rule of the plugin, with its state and why.
 * @type {Readonly<Record<string, { state: 'error' | 'off'; reason: string }>>}
 */
export const SECURITY_RULES = Object.freeze({
  'detect-unsafe-regex': {
    state: 'error',
    reason:
      'a nested quantifier can backtrack exponentially on untrusted text; safe-regex counts star height, so a site whose pattern eslint-plugin-regexp proves linear is suppressed with that reason',
  },
  'detect-eval-with-expression': {
    state: 'error',
    reason:
      'eval of a computed string runs code the module does not hold; the workflow code runner is the one place operator code runs (ADR 0007)',
  },
  'detect-child-process': {
    state: 'error',
    reason:
      'a shell command built from a value is command injection; processes start through execFile or spawn with an argument list',
  },
  'detect-non-literal-require': {
    state: 'error',
    reason:
      'a require of a computed name loads code chosen at run time; modules are imported by literal name',
  },
  'detect-buffer-noassert': {
    state: 'error',
    reason:
      'noAssert reads and writes past a buffer without a bounds check (removed from Node, kept as a guard)',
  },
  'detect-new-buffer': {
    state: 'error',
    reason:
      'new Buffer(number) returns uninitialised memory that can hold earlier data; Buffer.alloc and Buffer.from are used',
  },
  'detect-pseudoRandomBytes': {
    state: 'error',
    reason:
      'pseudoRandomBytes is not a cryptographic generator; tokens, keys and nonces come from randomBytes or webcrypto',
  },
  'detect-possible-timing-attacks': {
    state: 'error',
    reason:
      'an early-exit comparison of a secret leaks its prefix through timing; secrets compare with timingSafeEqual, and a presence check against null is suppressed with that reason',
  },
  'detect-bidi-characters': {
    state: 'error',
    reason:
      'a raw bidirectional control character makes source read differently from how it runs (Trojan Source); such characters are written as \\u escapes',
  },
  'detect-invisible-characters': {
    state: 'error',
    reason:
      'an invisible filler character (U+3164, U+FFA0) can hide an identifier or a value in source; 4.2.0 adds it beside the bidi rule',
  },
  'detect-disable-mustache-escape': {
    state: 'error',
    reason:
      'turning off a template engine escape (escapeMarkup = false) renders untrusted text as HTML',
  },
  'detect-no-csrf-before-method-override': {
    state: 'error',
    reason:
      'Express method override after its csrf middleware lets a request change method past the check; kept as a guard though the API is Fastify',
  },
  'detect-object-injection': {
    state: 'off',
    reason:
      'it flags every keyed access (value[key]) in typed code, thousands of sites where strict TypeScript and zod already bound the key; prototype pollution is held by the schemas and Object.create(null) maps',
  },
  'detect-non-literal-regexp': {
    state: 'off',
    reason:
      'C252.2 (operator-patterns.js, Workflow 11B) refuses every RegExp built at run time outside its reviewed call sites, each with its reason (regexpAllowlistGlobs), so this rule would repeat those findings without the allowlist',
  },
  'detect-non-literal-fs-filename': {
    state: 'off',
    reason:
      'on only in apps/api/scripts/, scripts/ and security/, where commands take paths from their arguments; off elsewhere because the services never take a file path from a request, which a source test holds (eslint-security.test.ts lists each module that reads files and where its paths come from)',
  },
});

/** Where `detect-non-literal-fs-filename` is on: the operator commands and the repository tools. */
export const NON_LITERAL_FS_FILENAME_FOLDERS = Object.freeze([
  'apps/api/scripts/**',
  'scripts/**',
  'security/**',
]);

/**
 * The inline suppressions each rule may carry, the count at the commit that set it (Workflow 11C,
 * every finding of the tree at that commit). Raising one needs a reason in that commit; the
 * suppressions themselves each carry theirs on their line.
 * - detect-unsafe-regex: sites whose nested quantifier eslint-plugin-regexp's analysis
 *   (no-super-linear-backtracking, no-super-linear-move) proves linear, and four bounded inputs
 *   named on their lines (an operator setting, a development script, collapsed OCR text, a
 *   500-character domain);
 * - detect-possible-timing-attacks: presence and emptiness checks against null, undefined or '',
 *   a policy cache key and a password against its own confirmation;
 * - detect-non-literal-fs-filename: the operator commands' own path arguments (kek:rewrap,
 *   trust-anchors:sync) and workflow-docs:write's fixed repository paths.
 * @type {Readonly<Record<string, number>>}
 */
export const SECURITY_SUPPRESSION_CEILING = Object.freeze({
  'detect-unsafe-regex': 168,
  'detect-possible-timing-attacks': 42,
  'detect-non-literal-fs-filename': 5,
});

/**
 * The plugin and its rules for every source file, then `detect-non-literal-fs-filename` in its
 * folders.
 * @returns {import('eslint').Linter.Config[]}
 */
export function securityConfig() {
  /** @type {import('eslint').Linter.RulesRecord} */
  const rules = Object.fromEntries(
    Object.entries(SECURITY_RULES).map(([rule, entry]) => [`security/${rule}`, entry.state]),
  );
  return [
    { files: SOURCE_FILES, plugins: { security }, rules },
    {
      files: [...NON_LITERAL_FS_FILENAME_FOLDERS],
      rules: { 'security/detect-non-literal-fs-filename': 'error' },
    },
  ];
}
