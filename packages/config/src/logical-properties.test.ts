/**
 * C161.3 (ours; the engineering note's 5.4): the flow and the shared UI use logical properties
 * only, so a right-to-left page mirrors itself. The rule refuses Tailwind's physical utilities
 * `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left` and `text-right` wherever a string
 * holds them (a `className`, a class map, a `cx` argument, a template literal), and lets the
 * logical ones through (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`).
 * Run with ESLint's `Linter` on synthetic code, as the Phase 5 rules are.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { LOGICAL_PROPERTIES_FILES, logicalPropertiesConfig } from '../eslint/logical-properties.js';

const RULE = 'openverify-i18n/logical-properties';

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
  {
    files: ['**/*.tsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  ...logicalPropertiesConfig(),
];

function lint(code: string, filename = 'apps/flow/src/steps/example.tsx') {
  return linter
    .verify(code, config, { filename })
    .map((message) => ({ rule: message.ruleId, message: message.message, line: message.line }));
}

const refused = (code: string, filename?: string) =>
  lint(code, filename).filter((message) => message.rule === RULE);

/**
 * A superset of what the rule refuses: every one of its eight physical prefixes, at a word start.
 * A file with no match cannot hold a finding, so the scan below lints only files that match
 * (Workflow 9A Stage 4, rule 6: linting all 287 files of the flow took 80 to 110 s under a busy
 * turbo run, past the 60 s guard). The case after the refusals holds the superset to the rule.
 */
const CANDIDATE = /\b(?:m[lr]|p[lr]|left|right)-|text-(?:left|right)\b/;

const REFUSED_UTILITIES = [
  'ml-2',
  'mr-4',
  'pl-0.5',
  'pr-px',
  'left-0',
  'right-1/2',
  'left-full',
  'right-[3px]',
  'ml-auto',
  'pl-(--gutter)',
  'text-left',
  'text-right',
  '-ml-2',
  '!pr-4',
  'md:ml-2',
  'hover:focus:text-right',
  'sm:-right-2',
];

describe('the logical-properties rule (C161.3)', () => {
  it.each(REFUSED_UTILITIES)('refuses %s in a className', (utility) => {
    const found = refused(`export const A = <p className="flex ${utility} gap-2" />;\n`);

    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.message).toContain(utility);
  });

  it.each([
    'ms-2',
    'me-4',
    'ps-0.5',
    'pe-px',
    'start-0',
    'end-1/2',
    'text-start',
    'text-end',
    'rtl:-scale-x-100',
    'rtl:ml-2',
    'ltr:text-left',
    'mx-2',
    'px-4',
    'inset-x-0',
    'border-s',
  ])('lets %s through', (utility) => {
    expect(refused(`export const A = <p className="flex ${utility} gap-2" />;\n`)).toEqual([]);
  });

  it('finds physical utilities in class maps, cx arguments and template literals', () => {
    const code = [
      'declare function cx(...names: string[]): string;',
      "const BASE = 'inline-flex pl-4';",
      "const VARIANTS = { primary: 'bg-primary', danger: 'text-right' };",
      "export const a = cx(BASE, VARIANTS.danger, 'mr-2');",
      'export const b = (size: number) => `flex ml-${String(size)}`;',
      'export const c = `items-center ${a} right-0`;',
    ].join('\n');

    expect(refused(code).map(({ line }) => line)).toEqual([2, 3, 4, 5, 6]);
  });

  it('never reads prose as a class list', () => {
    const code = [
      "export const a = 'Turn your head to the left.';",
      "export const b = 'right-to-left languages';",
      "export const c = 'turn-left';",
      "export const d = 'pose_not_left';",
      "export const e = 'left';",
    ].join('\n');

    expect(refused(code)).toEqual([]);
  });

  it('is never refused in a file the scan below skips: the candidate pattern finds every utility it refuses', () => {
    for (const utility of REFUSED_UTILITIES) {
      expect(CANDIDATE.test(`className="flex ${utility} gap-2"`), utility).toBe(true);
    }
  });

  it('applies to the flow and the shared UI only', () => {
    expect(LOGICAL_PROPERTIES_FILES).toEqual([
      'apps/flow/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
    ]);
    const code = 'export const a = <p className="ml-2" />;\n';

    expect(refused(code, 'packages/ui/src/button.tsx')).toHaveLength(1);
    expect(refused(code, 'apps/dashboard/src/app/page.tsx')).toEqual([]);
  });
});

/**
 * Until the root `eslint.config.js` spreads `logicalPropertiesConfig()` (an owner's edit: the
 * config-protection hook refuses an agent's), this holds every file of the flow and the shared UI
 * to the rule directly.
 */
describe('the flow and the shared UI as they are (C161.3)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it.each(['apps/flow/src', 'packages/ui/src'])('%s uses no physical utility', (folder) => {
    const findings = sourceFiles(join(REPO_ROOT, folder)).flatMap((path) => {
      const file = relative(REPO_ROOT, path).replaceAll('\\', '/');
      const code = readFileSync(path, 'utf8');
      if (!CANDIDATE.test(code)) {
        return [];
      }
      // A file that does not parse is a finding too, so a candidate file never passes unread.
      return lint(code, file)
        .filter(({ rule }) => rule === RULE || rule === null)
        .map(({ line, message }) => `${file}:${String(line)} ${message}`);
    });

    expect(findings).toEqual([]);
  });
});
