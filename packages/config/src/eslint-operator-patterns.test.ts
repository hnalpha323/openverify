/**
 * C252.2 (Workflow 11B, ingestion-11b; orchestrator decision 21 before 11B): a regular expression
 * built at run time. `phase5Config()` carries `no-restricted-syntax` selectors that refuse
 * `new RegExp(<anything but a literal>)` and every `RegExp(...)` call, everywhere in the
 * repository, outside an allowlist of reviewed call sites, each with its reason in
 * `packages/config/eslint/operator-patterns.js`. Operator or end-user text becomes a pattern only
 * through Phase 9's restricted grammar and linear-time matcher (C148.3: `compilePattern` and
 * `matchPattern` from `@openverify/flow-spec`), or it is refused at write time.
 *
 * The selectors join the shared `no-restricted-syntax` list of the Phase 5 and Workflow 7A folders,
 * because flat config does not merge one rule's options across config objects: a later entry for
 * the same files would otherwise replace the PII log-key selectors (C53.8, C93.7).
 *
 * Run with ESLint's `Linter` on synthetic code (the lint fixture below), as the Phase 5 rules are,
 * and then over every source file of the tree that names `RegExp`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import {
  OPERATOR_PATTERN_SELECTORS,
  REGEXP_EXEMPT_FILE_GROUPS,
  REVIEWED_REGEXP_CALL_SITES,
  regexpAllowlistGlobs,
} from '../eslint/operator-patterns.js';
import { phase5Config } from '../eslint/phase5-rules.js';

const SOURCE_FILES = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'];

const PARSER: Linter.Config[] = [
  {
    files: SOURCE_FILES,
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
];

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [...PARSER, ...phase5Config()];
/** The selectors alone, with no allowlist: what a reviewed file's call sites are counted with. */
const bare: Linter.Config[] = [
  ...PARSER,
  {
    files: SOURCE_FILES,
    rules: { 'no-restricted-syntax': ['error', ...OPERATOR_PATTERN_SELECTORS] },
  },
];

const isPatternFinding = (message: Linter.LintMessage) =>
  message.ruleId === 'no-restricted-syntax' && message.message.startsWith('C252');
const isLogFinding = (message: Linter.LintMessage) =>
  message.ruleId === 'no-restricted-syntax' && message.message.startsWith('C53.8');

const patternLines = (code: string, filename: string, rules = config) =>
  linter
    .verify(code, rules, { filename })
    .filter(isPatternFinding)
    .map((message) => message.line);

/** The lint fixture: each line builds a pattern from text the code does not hold. */
const LINT_FIXTURE = [
  'declare const source: string;',
  'export const a = new RegExp(source);',
  "export const b = new RegExp(source, 'u');",
  'export const c = new RegExp(`^${source}$`);',
  "export const d = new RegExp('^' + source);",
  'export const e = RegExp(source);',
  "export const f = RegExp('literal');",
  'export const g = new globalThis.RegExp(source);',
  'export const h = globalThis.RegExp(source);',
  '',
].join('\n');

/** What the rule leaves alone: literals, regex literals and references that build nothing. */
const ALLOWED = [
  'declare const value: unknown;',
  "export const a = new RegExp('^[a-z]+$');",
  "export const b = new RegExp('^[a-z]+$', 'u');",
  "export const c = new RegExp(/^[a-z]+$/, 'g');",
  'export const d = /^[a-z]+$/u;',
  'export const e = value instanceof RegExp;',
  'export const f = /x/.source;',
  '',
].join('\n');

const PHASE5_FILE = 'apps/api/src/services/otp/send.ts';
const NETWORK_FILE = 'apps/api/src/network/sync.ts';
const LOG_AND_PATTERN = [
  'declare const log: { info(o: object, m: string): void };',
  'declare const source: string;',
  "log.info({ email: 'x' }, 'sent');",
  'export const pattern = new RegExp(source);',
  '',
].join('\n');

describe('the run-time pattern rule (C252.2)', () => {
  it('is a no-restricted-syntax rule of phase5Config(), which the root config spreads', () => {
    expect(OPERATOR_PATTERN_SELECTORS.length).toBeGreaterThanOrEqual(4);
    const everywhere = phase5Config().filter((block) => {
      const rule = block.rules?.['no-restricted-syntax'];
      return (
        Array.isArray(rule) &&
        OPERATOR_PATTERN_SELECTORS.every((selector) => rule.includes(selector)) &&
        SOURCE_FILES.every((glob) => block.files?.includes(glob) === true)
      );
    });
    expect(everywhere).toHaveLength(1);
    expect(everywhere[0]?.ignores).toEqual(regexpAllowlistGlobs());

    const root = readFileSync(
      fileURLToPath(new URL('../../../eslint.config.js', import.meta.url)),
      'utf8',
    );
    expect(root).toContain(
      "import { phase5Config } from './packages/config/eslint/phase5-rules.js';",
    );
    expect(root).toContain('...phase5Config(),');
  });

  it.each([
    'packages/core/src/example.ts',
    'apps/dashboard/src/components/example.tsx',
    'apps/flow/src/example.tsx',
    'packages/config/eslint/example.mjs',
    'apps/api/example.cjs',
    PHASE5_FILE,
    NETWORK_FILE,
  ])('refuses every line of the lint fixture in %s', (filename) => {
    expect(patternLines(LINT_FIXTURE, filename)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('names C148.3 and the allowlist in its message', () => {
    const [finding] = linter
      .verify(LINT_FIXTURE, config, { filename: 'packages/core/src/example.ts' })
      .filter(isPatternFinding);
    expect(finding?.message).toContain('compilePattern');
    expect(finding?.message).toContain('operator-patterns.js');
  });

  it.each(['packages/core/src/example.ts', PHASE5_FILE, NETWORK_FILE])(
    'leaves literals, regex literals and plain references alone in %s',
    (filename) => {
      expect(patternLines(ALLOWED, filename)).toEqual([]);
    },
  );

  it.each([PHASE5_FILE, NETWORK_FILE])(
    'keeps the log-key selectors beside the pattern selectors in %s (one shared list)',
    (filename) => {
      const found = linter.verify(LOG_AND_PATTERN, config, { filename });
      expect(found.filter(isLogFinding).map((message) => message.line)).toEqual([3]);
      expect(found.filter(isPatternFinding).map((message) => message.line)).toEqual([4]);
    },
  );

  it('keeps the log-key selectors in a reviewed file of a Phase 5 folder, without the pattern ones', () => {
    const file = 'packages/checks/src/matching/postal-codes.ts';
    expect(REVIEWED_REGEXP_CALL_SITES.map((entry) => entry.file)).toContain(file);
    const found = linter.verify(LOG_AND_PATTERN, config, { filename: file });
    expect(found.filter(isLogFinding).map((message) => message.line)).toEqual([3]);
    expect(found.filter(isPatternFinding)).toEqual([]);
  });

  it.each([
    'apps/api/src/services/example.test.ts',
    'apps/dashboard/src/components/example.test.tsx',
    'apps/api/src/services/example.integration.test.ts',
    'e2e/tests/example.spec.ts',
    'e2e/tests/support/example.ts',
    'apps/flow/e2e/example.spec.ts',
    'packages/checks/scripts/example.ts',
  ])('lets tests, specs and development scripts build patterns: %s', (filename) => {
    expect(patternLines(LINT_FIXTURE, filename)).toEqual([]);
  });
});

describe('the allowlist (C252.2: each reviewed call site with its reason)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

  it('gives every exempt group and every reviewed file a reason', () => {
    expect(REGEXP_EXEMPT_FILE_GROUPS.length).toBeGreaterThan(0);
    expect(REVIEWED_REGEXP_CALL_SITES.length).toBeGreaterThan(0);
    for (const group of REGEXP_EXEMPT_FILE_GROUPS) {
      expect(group.globs.length).toBeGreaterThan(0);
      expect(group.reason.length).toBeGreaterThan(40);
    }
    for (const entry of REVIEWED_REGEXP_CALL_SITES) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(40);
      expect(entry.sites, entry.file).toBeGreaterThan(0);
    }
    expect(regexpAllowlistGlobs()).toEqual([
      ...REGEXP_EXEMPT_FILE_GROUPS.flatMap((group) => group.globs),
      ...REVIEWED_REGEXP_CALL_SITES.map((entry) => entry.file),
    ]);
  });

  it('lists each reviewed file once, and never the two entry points C252 changed', () => {
    const files = REVIEWED_REGEXP_CALL_SITES.map((entry) => entry.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).not.toContain('packages/flow-spec/src/flow.ts');
    expect(files).not.toContain('apps/dashboard/src/components/workflows/editor/document-model.ts');
  });

  it.each(REVIEWED_REGEXP_CALL_SITES.map((entry) => [entry.file, entry.sites] as const))(
    '%s exists and holds exactly its %i reviewed call sites (a new one needs its own review)',
    (file, sites) => {
      const path = join(REPO_ROOT, file);
      expect(existsSync(path)).toBe(true);
      expect(patternLines(readFileSync(path, 'utf8'), file, bare)).toHaveLength(sites);
    },
  );

  it('holds the shipped code of the tree to the rule (every source file that names RegExp)', () => {
    const SKIPPED = new Set([
      'node_modules',
      'dist',
      'build',
      'coverage',
      '.next',
      '.turbo',
      '.artifacts',
      '.gradle',
      '.venv',
    ]);
    const sourceFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return SKIPPED.has(entry.name) ? [] : sourceFiles(path);
        }
        return /\.(?:tsx?|m?js|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')
          ? [path]
          : [];
      });
    const roots = ['apps', 'packages', 'e2e', 'scripts', 'infra'].map((root) =>
      join(REPO_ROOT, root),
    );
    // Only a call or `new` of RegExp can be a finding, and a file of an exempt group cannot be
    // one (its exemption is held by the cases above), so only shipped candidates are parsed: the
    // whole tree's parse took 67 s of the 60 s guard at load 20 with the package's other suites.
    const CALL = /\bRegExp\s*(?:\?\.)?\(/;
    const exempt = REGEXP_EXEMPT_FILE_GROUPS.flatMap((group) => group.globs);
    let read = 0;
    let skippedExempt = 0;
    const findings = roots.filter(existsSync).flatMap((root) =>
      sourceFiles(root).flatMap((path) => {
        const file = relative(REPO_ROOT, path).replaceAll('\\', '/');
        const code = readFileSync(path, 'utf8');
        if (!CALL.test(code)) {
          return [];
        }
        if (exempt.some((glob) => matchesGlob(file, glob))) {
          skippedExempt += 1;
          return [];
        }
        read += 1;
        // A file that does not parse is a finding too, so a candidate never passes unread.
        return linter
          .verify(code, config, { filename: file })
          .filter((message) => isPatternFinding(message) || message.fatal === true)
          .map((message) => `${file}:${String(message.line)} ${message.message}`);
      }),
    );

    // Every reviewed file is among the shipped candidates read, and the tests among the exempt.
    expect(read).toBeGreaterThanOrEqual(REVIEWED_REGEXP_CALL_SITES.length);
    expect(skippedExempt).toBeGreaterThan(20);
    expect(findings).toEqual([]);
  });
});
