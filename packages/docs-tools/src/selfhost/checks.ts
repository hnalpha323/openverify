/**
 * The record checks over the guide's hand-written pages (C277; rules 21 and 22 of Workflow 11E):
 * every variable a page names is in `apps/api/src/config-registry.ts` (or is a compose or
 * repository variable), every command is a package script or a compiled command of the API image,
 * every repository path and relative link resolves, the publish switch governs
 * `verify-artifacts.md`, every page of the docs tree exists without its draft marker and the index
 * links it, and the figures the pages quote are the records' own. Checks read; they never write.
 */
import path from 'node:path';
import { CONFIG_REGISTRY, isPatternEntry } from '../../../../apps/api/src/config-registry.js';
import { DOCS_TREE, DRAFT_MARKER_PREFIX } from '../docs-tree.js';
import {
  DOCS_SWITCHES,
  PUBLISH_VARIABLE,
  RELEASE_WORKFLOW,
  publishGatedByVariable,
  publishJobOf,
  type DocsSwitches,
} from '../switches.js';
import type { CheckFinding, CheckResult, Repository } from '../types.js';
import { LOAD_REPORT, SUMMARY_SCHEMA, formatFigure, readSummaryBlock } from './figures.js';

/** The guide's directory. */
export const SELFHOST_DIR = 'docs/self-hosting';

/** The docs-tree pages that may keep their draft marker until a later checkpoint of this area. */
export const PENDING_PAGES: readonly string[] = [];

/** The compose file whose `${NAME}` interpolations are compose variables, not process variables. */
export const COMPOSE_FILE = 'infra/docker-compose.yml';

/** OPENVERIFY_ names that are no process's variable, each with what it is. */
export const NON_PROCESS_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  [PUBLISH_VARIABLE]: "release.yml's repository variable that gates its publish job (C262.2)",
});

/** The roots a cited repository path may start with. */
const PATH_ROOTS = [
  '.github',
  'android',
  'apps',
  'contracts',
  'deploy',
  'docs',
  'e2e',
  'infra',
  'load',
  'models',
  'network',
  'packages',
  'scripts',
  'security',
  'services',
];

/** The guide's Markdown pages, sorted. */
export function selfhostPages(repo: Repository): readonly string[] {
  return repo.listFiles(SELFHOST_DIR).filter((file) => file.endsWith('.md'));
}

/** The 1-based line of `index` in `text`. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function result(name: string, findings: readonly CheckFinding[]): CheckResult {
  return { name, status: 'built', findings };
}

function finding(rule: string, file: string, message: string, line?: number): CheckFinding {
  return line === undefined
    ? { rule, path: file, message, severity: 'error' }
    : { rule, path: file, line, message, severity: 'error' };
}

/** Every match of `pattern` over every page, with its page and line. */
function matchesIn(
  repo: Repository,
  pattern: RegExp,
): { file: string; line: number; match: RegExpExecArray }[] {
  return selfhostPages(repo).flatMap((file) => {
    const text = repo.readText(file);
    return [...text.matchAll(pattern)].map((match) => ({
      file,
      line: lineOf(text, match.index),
      match,
    }));
  });
}

/** Whether `name` is a variable some process reads, or the `_FILE` form of a secret one. */
function registered(name: string): boolean {
  const exact = new Set(
    CONFIG_REGISTRY.filter((entry) => !isPatternEntry(entry)).map((e) => e.name),
  );
  const files = new Set(
    CONFIG_REGISTRY.filter((entry) => entry.fileForm && !isPatternEntry(entry)).map(
      (entry) => `${entry.name}_FILE`,
    ),
  );
  if (exact.has(name) || files.has(name)) {
    return true;
  }
  return CONFIG_REGISTRY.filter(isPatternEntry).some((entry) => {
    const prefix = entry.prefix ?? '';
    if (!name.startsWith(prefix)) {
      return false;
    }
    return entry.fileForm || !name.endsWith('_FILE');
  });
}

/** Rule 22: every OPENVERIFY_ name a page cites is registered, a compose variable or named here. */
export function checkVariableNames(repo: Repository): CheckResult {
  const compose = repo.exists(COMPOSE_FILE) ? repo.readText(COMPOSE_FILE) : '';
  const composeNames = new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)/gu)].map((m) => m[1]));
  return result(
    'selfhost-variables',
    matchesIn(repo, /\bOPENVERIFY_[A-Z0-9_]+/gu).flatMap(({ file, line, match }) => {
      const name = match[0];
      const known =
        registered(name) || composeNames.has(name) || NON_PROCESS_VARIABLES[name] !== undefined;
      return known
        ? []
        : [
            finding(
              'variable',
              file,
              `names ${name}, which apps/api/src/config-registry.ts does not hold`,
              line,
            ),
          ];
    }),
  );
}

/** The scripts of every workspace package, by package name. */
function packageScripts(repo: Repository): Map<string, Set<string>> {
  const manifests = [...repo.listFiles('apps'), ...repo.listFiles('packages'), 'e2e/package.json']
    .filter((file) => /^(?:apps|packages)\/[^/]+\/package\.json$|^e2e\/package\.json$/u.test(file))
    .filter((file) => repo.exists(file));
  const scripts = new Map<string, Set<string>>();
  for (const file of manifests) {
    const manifest = JSON.parse(repo.readText(file)) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    if (manifest.name !== undefined) {
      scripts.set(manifest.name, new Set(Object.keys(manifest.scripts ?? {})));
    }
  }
  return scripts;
}

/** The commands `apps/api/tsconfig.commands.json` compiles into the API image. */
function compiledCommands(repo: Repository): Set<string> {
  const file = 'apps/api/tsconfig.commands.json';
  if (!repo.exists(file)) {
    return new Set();
  }
  const config = JSON.parse(repo.readText(file)) as { files?: string[] };
  return new Set(
    (config.files ?? []).map((source) => `dist/commands/${path.posix.basename(source, '.ts')}.js`),
  );
}

/** Rule 22: every `pnpm --filter` script and every `node dist/commands/` command exists. */
export function checkCommands(repo: Repository): CheckResult {
  const scripts = packageScripts(repo);
  const compiled = compiledCommands(repo);
  const filtered = matchesIn(
    repo,
    /pnpm --filter (@openverify\/[a-z0-9-]+) (?:run )?([a-z][a-z0-9:-]*)/gu,
  ).flatMap(({ file, line, match }) => {
    const [, name = '', script = ''] = match;
    const known = scripts.get(name);
    if (known === undefined) {
      return [
        finding(
          'command',
          file,
          `names the package ${name}, which the repository does not hold`,
          line,
        ),
      ];
    }
    return known.has(script) || script === 'exec'
      ? []
      : [finding('command', file, `runs ${script}, which ${name} has no script for`, line)];
  });
  const commands = matchesIn(repo, /\b(dist\/commands\/[a-z0-9-]+\.js)/gu).flatMap(
    ({ file, line, match }) =>
      compiled.has(match[1] ?? '')
        ? []
        : [
            finding(
              'command',
              file,
              `runs ${match[1] ?? ''}, which apps/api/tsconfig.commands.json does not compile`,
              line,
            ),
          ],
  );
  return result(
    'selfhost-commands',
    [...filtered, ...commands].sort((a, b) =>
      a.path === b.path ? (a.line ?? 0) - (b.line ?? 0) : a.path < b.path ? -1 : 1,
    ),
  );
}

/** Whether `relative` is a file, or a directory holding files, of the repository. */
function resolves(repo: Repository, relative: string): boolean {
  const clean = relative.replace(/\/$/u, '');
  return repo.exists(clean) || repo.listFiles(clean).length > 0;
}

/** Whether `cited` starts with one of {@link PATH_ROOTS} and a slash. */
function fromPathRoot(cited: string): boolean {
  return PATH_ROOTS.some((root) => cited.startsWith(`${root}/`));
}

/** `cited` without a `#anchor` and a trailing `:<line>` or `:<line>-<line>`. */
function withoutLines(anchored: string): string {
  const hash = anchored.indexOf('#');
  const cited = hash < 0 ? anchored : anchored.slice(0, hash);
  const colon = cited.lastIndexOf(':');
  return colon > 0 && /^[\d-]+$/u.test(cited.slice(colon + 1)) ? cited.slice(0, colon) : cited;
}

/** Every cited repository path (in backticks, from a known root) exists. */
export function checkRepositoryPaths(repo: Repository): CheckResult {
  return result(
    'selfhost-paths',
    matchesIn(repo, /`([^`\n]+)`/gu).flatMap(({ file, line, match }) => {
      const cited = withoutLines(match[1] ?? '');
      if (!fromPathRoot(cited) || /[\s<>{}*$]/u.test(cited)) {
        return [];
      }
      return resolves(repo, cited)
        ? []
        : [finding('repository-path', file, `cites ${cited}, which does not exist`, line)];
    }),
  );
}

/** Every relative Markdown link resolves from its page's directory. */
export function checkLinks(repo: Repository): CheckResult {
  return result(
    'selfhost-links',
    matchesIn(repo, /\]\(([^)\s]+)\)/gu).flatMap(({ file, line, match }) => {
      const target = match[1] ?? '';
      if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('#')) {
        return [];
      }
      const dir = path.posix.dirname(file);
      const resolved = path.posix.normalize(path.posix.join(dir, target.replace(/#.*$/u, '')));
      return resolves(repo, resolved)
        ? []
        : [finding('link', file, `links ${target}, which does not resolve from ${dir}/`, line)];
    }),
  );
}

/** The page whose content the publish switch governs. */
export const VERIFY_ARTIFACTS_PAGE = `${SELFHOST_DIR}/verify-artifacts.md`;
/** The statement the page makes while nothing is signed (review H16). */
export const UNSIGNED_STATEMENT = 'No artifact of this release is signed';

/** The OIDC issuer of a keyless signature made in GitHub Actions. */
export const ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';
/** What the page says once the publish job is wired (rule 10: what will be signed, and from when). */
export const STAGED_UNSIGNED_STATEMENT = 'Staged workflow artifacts are unsigned';
export const FIRST_PUBLICATION_STATEMENT = 'from the first approved publication on';
/** The manifests of the published npm packages, whose `repository` npm's provenance checks. */
export const PUBLISHED_MANIFESTS: readonly string[] = [
  'packages/sdk-js/package.json',
  'packages/node/package.json',
  'packages/sdk-react/package.json',
];

/** Whether the workflow's dispatch declares a `dry-run` input whose default is `true`. */
function dryRunDefaultsTrue(workflow: string): boolean {
  const lines = workflow.split('\n');
  const start = lines.indexOf('      dry-run:');
  if (start < 0) {
    return false;
  }
  const members: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('        ')) {
      break;
    }
    members.push(line);
  }
  return members.includes('        default: true');
}

/**
 * What release.yml must hold before the switch may be on (Workflow 11G's sub-parts
 * images-and-chart, sign-keyless, attestations and npm), each with what it is: the dispatch's
 * input is read from the whole workflow, the rest from the publish job.
 */
const PUBLISH_WIRING: readonly (readonly [string, (workflow: string, job: string) => boolean])[] = [
  ['the dry-run input defaulting to true', (workflow) => dryRunDefaultsTrue(workflow)],
  ["cosign's keyless signature of each image", (_, job) => job.includes('cosign sign --yes ')],
  [
    "cosign's SBOM attestation of each image",
    (_, job) => job.includes('cosign attest --yes --type cyclonedx '),
  ],
  ['the chart pushed as an OCI artifact', (_, job) => /helm push [^\n]*oci:\/\//u.test(job)],
  [
    'actions/attest-build-provenance',
    (_, job) => /uses: actions\/attest-build-provenance@[0-9a-f]{40}/u.test(job),
  ],
  [
    'pnpm publish with provenance and public access',
    (_, job) => /pnpm publish [^\n]*--provenance --access public/u.test(job),
  ],
];

/** The text of the `publish:` job of `release.yml` (its two-space key to the next one). */
function publishJobText(workflow: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === '  publish:');
  if (start < 0) {
    return '';
  }
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:/u.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
}

/** `owner/name` of the one GitHub repository the published manifests name, or `null`. */
export function publishedRepository(repo: Repository): string | null {
  const named = new Set(
    PUBLISHED_MANIFESTS.map((file) => {
      if (!repo.exists(file)) {
        return null;
      }
      const manifest = JSON.parse(repo.readText(file)) as { repository?: { url?: unknown } };
      const url = typeof manifest.repository?.url === 'string' ? manifest.repository.url : '';
      return /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\.git$/u.exec(url)?.[1] ?? null;
    }),
  );
  const [only] = [...named];
  return named.size === 1 && only !== undefined ? only : null;
}

/** The certificate identity of release.yml's keyless signatures on `main`. */
export function releaseIdentity(repository: string): string {
  return `https://github.com/${repository}/${RELEASE_WORKFLOW}@refs/heads/main`;
}

/** The page's checks and statements while the switch is on (Workflow 11G, publish-11g). */
function wiredFindings(repo: Repository, page: string, text: string): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const workflow = repo.exists(RELEASE_WORKFLOW) ? repo.readText(RELEASE_WORKFLOW) : '';
  const job = publishJobText(workflow);
  for (const [what, holds] of PUBLISH_WIRING) {
    if (!holds(workflow, job)) {
      findings.push(
        finding(
          'publish-switch',
          page,
          `publishWired is on, but ${RELEASE_WORKFLOW}'s publish job lacks ${what}`,
        ),
      );
    }
  }
  const lines = text.replace(/\\\n\s*/gu, ' ').split('\n');
  const has = (...parts: string[]): boolean =>
    lines.some((line) => parts.every((part) => line.includes(part)));
  const repository = publishedRepository(repo);
  if (repository === null) {
    findings.push(
      finding(
        'publish-switch',
        page,
        `the published packages (${PUBLISHED_MANIFESTS.join(', ')}) name no single GitHub repository, so the certificate identity cannot be stated`,
      ),
    );
  } else {
    const identity = `--certificate-identity ${releaseIdentity(repository)}`;
    const issuer = `--certificate-oidc-issuer ${ACTIONS_ISSUER}`;
    if (
      !lines.some(
        (line) =>
          /\bcosign verify\s/u.test(line) && line.includes(identity) && line.includes(issuer),
      )
    ) {
      findings.push(
        finding(
          'publish-switch',
          page,
          `gives no cosign verify command with ${identity} and ${issuer} while publishWired is on`,
        ),
      );
    }
    if (!has('cosign verify-attestation', '--type cyclonedx', identity, issuer)) {
      findings.push(
        finding(
          'publish-switch',
          page,
          `gives no cosign verify-attestation --type cyclonedx command with ${identity} and ${issuer} while publishWired is on`,
        ),
      );
    }
    if (!has('gh attestation verify', `--repo ${repository}`)) {
      findings.push(
        finding(
          'publish-switch',
          page,
          `gives no gh attestation verify command with --repo ${repository} while publishWired is on`,
        ),
      );
    }
  }
  if (!text.includes('npm audit signatures')) {
    findings.push(
      finding(
        'publish-switch',
        page,
        'gives no npm audit signatures check while publishWired is on',
      ),
    );
  }
  for (const statement of [
    UNSIGNED_STATEMENT,
    STAGED_UNSIGNED_STATEMENT,
    FIRST_PUBLICATION_STATEMENT,
  ]) {
    if (!text.toLowerCase().includes(statement.toLowerCase())) {
      findings.push(
        finding('publish-switch', page, `says nothing of "${statement}" while publishWired is on`),
      );
    }
  }
  return findings;
}

/**
 * C277.1, review H16 and 11E decisions item 18: the publish switch governs verify-artifacts.md.
 * Off, the page says nothing is signed and gives no verification command; on (Workflow 11G), it
 * gives each check for the wired sub-parts with the release workflow's identity, still says that
 * nothing is signed until the first approved publication, and release.yml must hold the wiring.
 * Either way the publish job stays gated by the owner's variable in the `release` environment.
 */
export function checkPublishSwitch(
  repo: Repository,
  switches: DocsSwitches = DOCS_SWITCHES,
): CheckResult {
  const page = VERIFY_ARTIFACTS_PAGE;
  const text = repo.exists(page) ? repo.readText(page) : '';
  const findings: CheckFinding[] = [];
  const verify = /cosign verify/u.exec(text);
  if (switches.publishWired) {
    findings.push(...wiredFindings(repo, page, text));
  } else {
    if (!text.toLowerCase().includes(UNSIGNED_STATEMENT.toLowerCase())) {
      findings.push(
        finding(
          'publish-switch',
          page,
          `says nothing of "${UNSIGNED_STATEMENT}" while publishWired is off`,
        ),
      );
    }
    if (verify !== null) {
      findings.push(
        finding(
          'publish-switch',
          page,
          'gives a cosign verify command while publishWired is off',
          lineOf(text, verify.index),
        ),
      );
    }
  }
  const workflow = repo.exists(RELEASE_WORKFLOW) ? repo.readText(RELEASE_WORKFLOW) : '';
  if (!publishGatedByVariable(publishJobOf(workflow))) {
    findings.push(
      finding(
        'publish-switch',
        page,
        `${RELEASE_WORKFLOW}'s publish job is no longer gated by ${PUBLISH_VARIABLE} in the release environment`,
      ),
    );
  }
  return result('selfhost-publish-switch', findings);
}

/** Every docs-tree page of this area exists, holds no draft marker and is linked from the index. */
export function checkPages(repo: Repository): CheckResult {
  const pages = DOCS_TREE.filter((item) => item.owner === 'docs-selfhost').map((item) => item.path);
  const index = `${SELFHOST_DIR}/README.md`;
  const indexText = repo.exists(index) ? repo.readText(index) : '';
  return result(
    'selfhost-pages',
    pages.flatMap((page): CheckFinding[] => {
      if (!repo.exists(page)) {
        return [finding('page', page, 'is missing')];
      }
      const found: CheckFinding[] = [];
      const text = repo.readText(page);
      const marker = text.indexOf(DRAFT_MARKER_PREFIX);
      if (marker >= 0 && !PENDING_PAGES.includes(page)) {
        found.push(finding('page', page, 'still holds its draft marker', lineOf(text, marker)));
      }
      const name = page.slice(`${SELFHOST_DIR}/`.length);
      if (page !== index && !indexText.includes(`](${name})`)) {
        found.push(finding('page', page, `is not linked from ${index}`));
      }
      return found;
    }),
  );
}

/** A figure one page must quote, read from a record. */
interface QuotedFact {
  readonly page: string;
  readonly text: string;
  readonly source: string;
}

/** The ACL user Workflow 11B tested (platform-ops item 4), read from the plan. */
function testedAcl(repo: Repository): string | null {
  const plan = 'docs/plans/phase-11.plan.md';
  if (!repo.exists(plan)) {
    return null;
  }
  return /`(on >pw [^`]+)`/u.exec(repo.readText(plan))?.[1] ?? null;
}

/** The figures database.md and valkey.md must quote, from the load report and the plan. */
function quotedFacts(repo: Repository): { facts: QuotedFact[]; errors: CheckFinding[] } {
  const errors: CheckFinding[] = [];
  const facts: QuotedFact[] = [];
  const database = `${SELFHOST_DIR}/database.md`;
  if (!repo.exists(LOAD_REPORT) || !repo.exists(SUMMARY_SCHEMA)) {
    errors.push(finding('quoted-fact', LOAD_REPORT, `cannot be read with ${SUMMARY_SCHEMA}`));
  } else {
    const read = readSummaryBlock(
      repo.readText(LOAD_REPORT),
      JSON.parse(repo.readText(SUMMARY_SCHEMA)) as unknown,
    );
    errors.push(...read.errors.map((error) => finding('quoted-fact', LOAD_REPORT, error)));
    const wanted: readonly [string, (median: number) => string][] = [
      ['role-timeouts', (median) => `${formatFigure(median)} s`],
      ['jit-comparison', (median) => `${median.toFixed(2)} times`],
      ['pool-at-knee', (median) => `${formatFigure(median)} connections`],
    ];
    for (const [id, quote] of wanted) {
      const median = read.summary?.rows.find((row) => row.id === id)?.median;
      if (read.summary === null) {
        continue;
      }
      if (median === undefined || median === null) {
        errors.push(finding('quoted-fact', LOAD_REPORT, `has no figure for ${id}`));
      } else {
        facts.push({ page: database, text: quote(median), source: `${id}, ${LOAD_REPORT}` });
      }
    }
  }
  const acl = testedAcl(repo);
  if (acl === null) {
    errors.push(
      finding('quoted-fact', 'docs/plans/phase-11.plan.md', 'holds no tested Valkey ACL'),
    );
  } else {
    facts.push({
      page: `${SELFHOST_DIR}/valkey.md`,
      text: acl,
      source: 'the ACL Workflow 11B tested, docs/plans/phase-11.plan.md',
    });
  }
  return { facts, errors };
}

/** database.md quotes C272's figures and valkey.md the ACL 11B tested, from their records. */
export function checkQuotedFacts(repo: Repository): CheckResult {
  const { facts, errors } = quotedFacts(repo);
  return result('selfhost-quoted-facts', [
    ...errors,
    ...facts.flatMap((fact) =>
      repo.exists(fact.page) && repo.readText(fact.page).includes(fact.text)
        ? []
        : [finding('quoted-fact', fact.page, `does not quote "${fact.text}" (${fact.source})`)],
    ),
  ]);
}
