/**
 * C260.1 and C260.2 (Workflow 11C, sast-pii-11c; decision 2, OD-11C-1): the SAST baseline.
 *
 * `packages/config/eslint/security.js` configures every rule of eslint-plugin-security 4.2.0, each
 * on or off with its reason, and `phase5Config()` spreads it, so it runs wherever the root
 * `eslint.config.js` does (pnpm lint, CI's lint job). These tests pin:
 * - the states and reasons, and each rule's state in `phase5Config()`'s output for a source file;
 * - a lint fixture per rule that is on (assembled here, so this file holds no finding itself);
 * - `detect-non-literal-fs-filename` only in `apps/api/scripts/`, `scripts/` and `security/`, with a
 *   source test that the services' file reads take no path from a request;
 * - every inline suppression of a security rule carries its reason, per rule within the committed
 *   ceiling;
 * - C260.2: eslint-plugin-no-unsanitized is not adopted, so a source test keeps every non-test
 *   module from writing HTML through the DOM (`innerHTML`, `outerHTML`, `insertAdjacentHTML`,
 *   `document.write`, `dangerouslySetInnerHTML`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { phase5Config } from '../eslint/phase5-rules.js';
import {
  NON_LITERAL_FS_FILENAME_FOLDERS,
  SECURITY_RULES,
  SECURITY_SUPPRESSION_CEILING,
  securityConfig,
} from '../eslint/security.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_FILES = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'];
const PARSER: Linter.Config[] = [
  {
    files: SOURCE_FILES,
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
];

/** C260.1's lists: on, and off with a reason; 4.2.0 adds detect-invisible-characters (on). */
const ON = [
  'detect-unsafe-regex',
  'detect-eval-with-expression',
  'detect-child-process',
  'detect-non-literal-require',
  'detect-buffer-noassert',
  'detect-new-buffer',
  'detect-pseudoRandomBytes',
  'detect-possible-timing-attacks',
  'detect-bidi-characters',
  'detect-disable-mustache-escape',
  'detect-no-csrf-before-method-override',
  'detect-invisible-characters',
];
const OFF = [
  'detect-object-injection',
  'detect-non-literal-regexp',
  'detect-non-literal-fs-filename',
];

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [...PARSER, ...phase5Config()];
const securityFindings = (code: string, filename: string) =>
  linter
    .verify(code, config, { filename })
    .filter((message) => message.ruleId?.startsWith('security/') === true)
    .map((message) => message.ruleId);

/** One fixture per rule that is on; a character the bidi and invisible rules read is built here. */
const FIXTURES: Record<string, string> = {
  'detect-unsafe-regex': 'export const pattern = /^(a+)+$/;',
  'detect-eval-with-expression': 'declare const code: string;\neval(code);',
  'detect-child-process':
    "import { exec } from 'node:child_process';\ndeclare const command: string;\nexec(command);",
  'detect-non-literal-require': 'declare const name: string;\nrequire(name);',
  'detect-buffer-noassert': 'declare const bytes: Buffer;\nbytes.readUInt8(0, true);',
  'detect-new-buffer': 'declare const size: number;\nexport const bytes = new Buffer(size);',
  'detect-pseudoRandomBytes':
    "import crypto from 'node:crypto';\nexport const bytes = crypto.pseudoRandomBytes(8);",
  'detect-possible-timing-attacks':
    'declare const token: string;\ndeclare const given: string;\nif (token === given) {\n  given.trim();\n}',
  'detect-bidi-characters': `export const text = 'a${String.fromCodePoint(0x202e)}b';`,
  'detect-disable-mustache-escape':
    'declare const engine: { escapeMarkup: boolean };\nengine.escapeMarkup = false;',
  'detect-no-csrf-before-method-override':
    'declare const express: { csrf(): void; methodOverride(): void };\nexpress.csrf();\nexpress.methodOverride();',
  'detect-invisible-characters': `export const text = 'a${String.fromCodePoint(0x3164)}b';`,
};

const SERVICE_FILE = 'apps/api/src/services/example.ts';

describe('eslint-plugin-security in phase5Config() (C260.1)', () => {
  it('gives every rule of the plugin a state and a reason', () => {
    expect(Object.keys(SECURITY_RULES).sort()).toEqual(Object.keys(security.rules).sort());
    for (const [rule, entry] of Object.entries(SECURITY_RULES)) {
      expect(entry.reason.length, rule).toBeGreaterThan(40);
    }
    const on = Object.entries(SECURITY_RULES).filter(([, entry]) => entry.state === 'error');
    const off = Object.entries(SECURITY_RULES).filter(([, entry]) => entry.state === 'off');
    expect(on.map(([rule]) => rule).sort()).toEqual([...ON].sort());
    expect(off.map(([rule]) => rule).sort()).toEqual([...OFF].sort());
  });

  it('names its reasons for the three rules that are off', () => {
    expect(SECURITY_RULES['detect-object-injection']?.reason).toMatch(/keyed access/u);
    expect(SECURITY_RULES['detect-non-literal-regexp']?.reason).toMatch(/C252\.2/u);
    expect(SECURITY_RULES['detect-non-literal-fs-filename']?.reason).toMatch(
      /apps\/api\/scripts\/.*scripts\/.*security\//u,
    );
  });

  it('is spread by phase5Config(), which the root eslint.config.js spreads', () => {
    const blocks = securityConfig();
    expect(blocks.length).toBeGreaterThan(0);
    const spread = phase5Config();
    for (const block of blocks) {
      expect(spread).toContainEqual(block);
    }
    const root = readFileSync(join(REPO_ROOT, 'eslint.config.js'), 'utf8');
    expect(root).toContain('...phase5Config(),');
  });

  it.each([
    SERVICE_FILE,
    'apps/dashboard/src/components/example.tsx',
    'apps/flow/server.ts',
    'packages/core/src/example.ts',
    'packages/config/eslint/example.js',
    'e2e/tests/example.spec.ts',
    'apps/api/scripts/example.ts',
  ])('sets each rule as security.js says in %s', async (filename) => {
    const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfigFile: true, overrideConfig: config });
    const resolved = (await eslint.calculateConfigForFile(join(REPO_ROOT, filename))) as {
      rules: Record<string, [number, ...unknown[]] | undefined>;
    };
    const fsFolder = NON_LITERAL_FS_FILENAME_FOLDERS.some((glob) =>
      filename.startsWith(glob.replace('**', '')),
    );
    for (const [rule, entry] of Object.entries(SECURITY_RULES)) {
      const expected =
        rule === 'detect-non-literal-fs-filename' && fsFolder ? 2 : entry.state === 'error' ? 2 : 0;
      expect(resolved.rules[`security/${rule}`]?.[0] ?? 0, rule).toBe(expected);
    }
  });

  it.each(ON)('reports its lint fixture: %s', (rule) => {
    expect(securityFindings(FIXTURES[rule] ?? '', SERVICE_FILE)).toEqual([`security/${rule}`]);
  });

  it('leaves keyed access and run-time patterns to the type checker and C252.2', () => {
    const code = [
      'declare const values: Record<string, number>;',
      'declare const key: string;',
      'declare const source: string;',
      'export const value = values[key];',
      'export const pattern = new RegExp(source);',
    ].join('\n');
    expect(securityFindings(code, SERVICE_FILE)).toEqual([]);
  });

  it('reads non-literal file names only in apps/api/scripts/, scripts/ and security/', () => {
    expect([...NON_LITERAL_FS_FILENAME_FOLDERS]).toEqual([
      'apps/api/scripts/**',
      'scripts/**',
      'security/**',
    ]);
    const code = [
      "import { readFileSync } from 'node:fs';",
      'declare const path: string;',
      "export const text = readFileSync(path, 'utf8');",
    ].join('\n');
    const rule = 'security/detect-non-literal-fs-filename';
    expect(securityFindings(code, SERVICE_FILE)).toEqual([]);
    expect(securityFindings(code, 'apps/api/scripts/example.ts')).toEqual([rule]);
    expect(securityFindings(code, 'scripts/example.mjs')).toEqual([rule]);
    expect(securityFindings(code, 'security/example.mjs')).toEqual([rule]);
  });
});

// ---------------------------------------------------------------------------- the tree --------

const SKIPPED = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.artifacts',
  '.git',
  '.gradle',
]);
const SOURCE = /\.(?:ts|tsx|js|mjs|cjs)$/u;

/** Every source file of the lint scope: the workspace packages (apps/*, packages/*, e2e). */
function lintScope(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SOURCE.test(entry.name) && !entry.name.endsWith('next-env.d.ts')) {
        found.push(relative(REPO_ROOT, path));
      }
    }
  };
  for (const top of ['apps', 'packages', 'e2e']) walk(join(REPO_ROOT, top));
  return found.sort();
}

const FILES = lintScope();
const textOf = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8');

/** A test, a test helper, a fixture, a development script or a build configuration. */
const NOT_PRODUCTION =
  /(?:\.(?:test|spec|test-support)\.[cm]?[jt]sx?$|(?:^|\/)(?:test-support|testing|tests|test|e2e|fixtures|scripts|__mocks__)\/|(?:^|\/)(?:testing|test-support)\.[cm]?[jt]s$|\.d\.ts$|(?:^|\/)[a-z.-]+\.config\.[cm]?[jt]s$|^e2e\/)/u;
const PRODUCTION = FILES.filter((file) => !NOT_PRODUCTION.test(file));

describe('the inline suppressions (C260.1: each with its reason, counted against the ceiling)', () => {
  const DIRECTIVE =
    /(?:\/\/|\/\*)[ \t]*eslint-disable(?<kind>-next-line|-line)?[ \t]+(?<body>[^\n]*)/gu;

  const suppressions = FILES.flatMap((file) =>
    [...textOf(file).matchAll(DIRECTIVE)].flatMap((match) => {
      const body = (match.groups?.body ?? '').replace(/\s*\*\/.*$/u, '');
      const [names = '', reason = ''] = body.split(/\s--\s/u);
      return names
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.startsWith('security/'))
        .map((name) => ({
          file,
          rule: name.slice('security/'.length),
          kind: match.groups?.kind ?? '',
          reason: reason.trim(),
        }));
    }),
  );

  it('names only rules of the plugin, line by line, never a whole file', () => {
    for (const entry of suppressions) {
      expect(Object.keys(SECURITY_RULES), entry.file).toContain(entry.rule);
      expect(['-next-line', '-line'], entry.file).toContain(entry.kind);
    }
  });

  it('gives every suppression its reason', () => {
    const missing = suppressions.filter((entry) => entry.reason.length < 20);
    expect(missing).toEqual([]);
  });

  it('stays within the committed ceiling per rule', () => {
    const counts: Record<string, number> = {};
    for (const entry of suppressions) counts[entry.rule] = (counts[entry.rule] ?? 0) + 1;
    for (const [rule, count] of Object.entries(counts)) {
      expect(count, rule).toBeLessThanOrEqual(SECURITY_SUPPRESSION_CEILING[rule] ?? 0);
    }
    for (const [rule, ceiling] of Object.entries(SECURITY_SUPPRESSION_CEILING)) {
      expect(Object.keys(SECURITY_RULES), rule).toContain(rule);
      expect(ceiling, rule).toBeGreaterThan(0);
    }
  });
});

describe('the services take no file path from a request (detect-non-literal-fs-filename off)', () => {
  const FS_IMPORT = /from ['"](?:node:)?fs(?:\/promises)?['"]|require\(['"](?:node:)?fs['"]\)/u;
  const FS_CALL =
    /\b(?:readFileSync|readFile|writeFileSync|writeFile|createReadStream|createWriteStream|readdirSync|readdir|statSync|stat|open|openSync|mkdirSync|mkdir|rm|chmod|realpath|existsSync|mkdtemp)\(/gu;
  const REQUEST_INPUT = /\b(?:request|req)\.(?:body|params|query|headers|url|raw)\b/u;

  /** Every production module that imports the file system, with what its paths come from. */
  const REVIEWED: Record<string, string> = {
    'apps/api/src/config/secret-files.ts': 'the <NAME>_FILE paths of the process environment',
    'apps/api/src/config/store-tls.ts': 'the CA file paths of the process environment',
    'apps/api/src/contact/disposable-list.ts': 'the data file shipped beside the module',
    'apps/api/src/network/asn-data.ts': 'the network data directory of the configuration',
    'apps/api/src/network/download.ts': 'a private temporary directory of the sync',
    'apps/api/src/network/manifest.ts': 'the network manifest path of the configuration',
    'apps/api/src/network/sync.ts': 'the files its own download wrote',
    'apps/api/src/providers/ip-reputation/index.ts':
      'OPENVERIFY_IP_REPUTATION_MMDB_PATH, an absolute path the operator sets',
    'apps/api/src/providers/malicious-website/feed-list.ts':
      'the feed file path of the configuration',
    'apps/api/src/routes/dashboard/network-sources.ts':
      'the manifest.json of the configured network data directory, never a request value',
    'apps/api/src/seed/dev-seed.ts': 'the repository fixtures the seed command reads',
    'apps/api/src/services/flow-views/share-consent.ts':
      'the committed consent texts beside the module',
    'apps/api/src/services/reports/source-catalog.ts':
      'the committed watchlist manifest beside the module',
    'apps/api/src/services/sandbox-chip.ts':
      'OPENVERIFY_SANDBOX_CHIP_FACES and a fixed file name inside it',
    'apps/api/src/services/templates/consent-texts.ts': 'the committed consent texts',
    'apps/api/src/services/templates/locale-review.ts': 'the committed locale review records',
    'apps/api/src/services/templates/preview.ts': 'the committed preview texts',
    'apps/api/src/sync/runner.ts': 'its own temporary directory under the system temp',
    'apps/api/src/trust-anchors/load.ts': 'the trust-anchor bundle path of the configuration',
    'apps/api/src/version.ts': "the API's own package.json",
    'apps/api/src/watchlists/download.ts': 'a private temporary directory of the sync',
    'apps/api/src/watchlists/formats.ts': 'a file handle the sync opened',
    'apps/api/src/watchlists/manifest.ts': 'the committed watchlist manifest',
    'apps/api/src/watchlists/sync.ts':
      "the sync's temporary directory, or the operator's --import path of watchlists:sync",
    'apps/api/src/webhooks/samples.ts': 'the committed sample payloads beside the module',
    'apps/api/src/worker-health.ts': 'OPENVERIFY_WORKER_HEARTBEAT_FILE',
    'apps/api/src/worker-health/heartbeat.ts': 'OPENVERIFY_WORKER_HEARTBEAT_FILE',
    'apps/dashboard/server.ts':
      "the <NAME>_FILE paths of the process environment (C249.2) and the standalone output's configuration beside the server",
    'apps/dashboard/src/components/connect/connect-fixtures.ts':
      "the repository's contracts/fixtures goldens, for the console's tests",
    'apps/demo-web/src/server/app.ts':
      "the sample's built page: a URL path is resolved under its static directory and refused unless its real path stays inside it",
    'apps/flow/server.ts':
      'the built bundle: a URL path is resolved under the dist root and refused unless its real path stays inside it (C157)',
    'apps/flow/src/vite-plugins/guidance-assets-plugin.ts':
      'the pinned model manifest at build time',
    'packages/checks/src/calibration/cli.ts': "the calibration command's own arguments",
    'packages/checks/src/matching/data-files.ts': 'the data files shipped beside the module',
    'packages/checks/src/reports/build-data.ts': 'the repository data files at build time',
    'packages/checks/src/reports/data.ts': 'the data files shipped beside the module',
    'packages/db/src/migrate.ts': 'the migrations folder shipped beside the module',
    // Workflow 11E (contracts-11e): the private document tools, never shipped.
    'packages/docs-tools/src/cli.ts':
      "the repository root from the module's place, and a render's repository-relative paths, refused when one leaves the tree",
    'packages/docs-tools/src/repository.ts':
      "the repository root from the module's place, and repository-relative paths, refused when absolute or climbing out with ..",
    'packages/flow-spec/src/v2/golden/v1-sources.ts': 'the committed golden flows',
    'packages/workflow-engine/bin/code-runner-server.mjs':
      'OPENVERIFY_CODE_RUNNER_TOKEN_FILE from the process environment (C249.2, C263.6)',
    'packages/watchlist/src/keys/variant-groups.ts': 'the data files shipped beside the module',
    'packages/watchlist/src/names/legal-forms.ts': 'the data file shipped beside the module',
    'packages/watchlist/src/pep/positions.ts': 'the data file shipped beside the module',
    'packages/watchlist/src/zip/reader.ts': 'a file handle its caller opened',
    'packages/workflow-engine/src/code-runner/paths.ts': "the runner's own package.json",
    'packages/workflow-engine/src/code-runner/socket-server.ts':
      'OPENVERIFY_CODE_RUNNER_SOCKET, the socket path the operator sets',
    'packages/workflow-engine/bin/code-runner-child.mjs': "the runner's own bundled modules",
  };

  const importers = PRODUCTION.filter((file) => FS_IMPORT.test(textOf(file)));

  it('lists every production module that imports the file system, each with its source of paths', () => {
    expect(importers.filter((file) => !(file in REVIEWED))).toEqual([]);
    for (const reason of Object.values(REVIEWED)) expect(reason.length).toBeGreaterThan(10);
  });

  it('passes no request value to a file-system call', () => {
    const offending = importers.flatMap((file) => {
      const text = textOf(file);
      return [...text.matchAll(FS_CALL)].flatMap((match) => {
        const start = match.index + match[0].length;
        let depth = 1;
        let end = start;
        while (end < text.length && depth > 0) {
          if (text[end] === '(') depth += 1;
          else if (text[end] === ')') depth -= 1;
          end += 1;
        }
        const argument = text.slice(start, end - 1);
        return REQUEST_INPUT.test(argument) ? [`${file}: ${match[0]}${argument}`] : [];
      });
    });
    expect(offending).toEqual([]);
  });
});

describe('no module writes HTML through the DOM (C260.2: eslint-plugin-no-unsanitized not adopted)', () => {
  const HTML_SINKS =
    /\.(?:innerHTML|outerHTML)\s*[+]?=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\bdangerouslySetInnerHTML\b/u;

  it('finds no HTML sink outside tests and test helpers', () => {
    expect(PRODUCTION.length).toBeGreaterThan(1000);
    expect(PRODUCTION.filter((file) => HTML_SINKS.test(textOf(file)))).toEqual([]);
  });

  it('would find each sink (fragments assembled here)', () => {
    for (const sink of [
      'element.inner' + 'HTML = text;',
      'element.outer' + 'HTML += text;',
      'element.insertAdjacent' + "HTML('beforeend', text);",
      'document.' + 'write(text);',
      '<div dangerouslySet' + 'InnerHTML={{ __html: text }} />',
    ]) {
      expect(HTML_SINKS.test(sink), sink).toBe(true);
    }
    expect(HTML_SINKS.test('expect(container.inner' + "HTML).not.toContain('x');")).toBe(false);
  });
});
