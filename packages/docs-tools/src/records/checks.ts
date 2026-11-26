/**
 * C276 (Workflow 11E, `docs-records`): the record rules the hand-written security records share
 * (rule 21: "an entry per registry item, a path that exists, a list equal to the code's list").
 * Each reads a page's inline code spans: a repository path must exist, a `pnpm` command must name a
 * script its package has, a configuration variable must be one `config-registry.ts` holds, and a
 * required name must be there. Nothing here writes.
 */
import { CONFIG_REGISTRY, isPatternEntry } from '../../../../apps/api/src/config-registry.js';
import { DRAFT_MARKER_PREFIX } from '../docs-tree.js';
import { PUBLISH_VARIABLE } from '../switches.js';
import type { CheckFinding, Repository } from '../types.js';

/** The text of every inline code span of a Markdown page, in order; fenced blocks are skipped. */
export function codeSpans(text: string): readonly string[] {
  const spans: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      for (const match of line.matchAll(/`([^`]+)`/g)) {
        spans.push(match[1] ?? '');
      }
    }
  }
  return spans;
}

const finding = (rule: string, path: string, message: string): CheckFinding => ({
  rule,
  path,
  message,
  severity: 'error',
});

/** A remaining docs-tree draft marker. */
export function draftFindings(path: string, text: string): readonly CheckFinding[] {
  return text.includes(DRAFT_MARKER_PREFIX)
    ? [finding('draft-marker', path, 'still holds the docs-tree draft marker')]
    : [];
}

/** The top-level directories a cited repository path starts with. */
const PATH_ROOTS = [
  '.github/',
  'android/',
  'apps/',
  'contracts/',
  'deploy/',
  'docs/',
  'e2e/',
  'infra/',
  'load/',
  'packages/',
  'scripts/',
  'security/',
  'services/',
];

/** A root file a page may cite by name. */
const ROOT_FILES = new Set(['SECURITY.md', 'THIRD_PARTY_LICENSES.md', 'CLAUDE.md', '.env.example']);

/** The path a span cites, without a `:line` suffix or a glob tail; `null` when it is no path. */
function citedPath(span: string): string | null {
  if (ROOT_FILES.has(span)) {
    return span;
  }
  if (!PATH_ROOTS.some((root) => span.startsWith(root)) || /[\s<>{}]/.test(span)) {
    return null;
  }
  const withoutLine = span.replace(/:[\d,:\s-]+$/, '');
  const star = withoutLine.indexOf('*');
  const base =
    star === -1 ? withoutLine : withoutLine.slice(0, withoutLine.lastIndexOf('/', star) + 1);
  return base.replace(/\/$/, '');
}

function pathExists(repo: Repository, path: string): boolean {
  return repo.exists(path) || repo.listFiles(path).length > 0;
}

/** A repository path a code span cites that does not exist (as a file or a directory). */
export function pathFindings(
  repo: Repository,
  path: string,
  text: string,
): readonly CheckFinding[] {
  const missing = new Set<string>();
  for (const span of codeSpans(text)) {
    const cited = citedPath(span);
    if (cited !== null && cited !== '' && !pathExists(repo, cited)) {
      missing.add(cited);
    }
  }
  return [...missing].map((cited) =>
    finding('path-exists', path, `cites ${cited}, which does not exist in the repository`),
  );
}

/** The directories whose `package.json` files name the workspace packages. */
const PACKAGE_DIRECTORIES = ['apps', 'packages', 'e2e', 'load'];

interface PackageScripts {
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
}

function readPackage(repo: Repository, file: string): PackageScripts | null {
  try {
    const parsed = JSON.parse(repo.readText(file)) as Partial<PackageScripts>;
    return { name: parsed.name ?? '', scripts: parsed.scripts ?? {} };
  } catch {
    return null;
  }
}

const scriptsCache = new WeakMap<
  Repository,
  ReadonlyMap<string, Readonly<Record<string, string>>>
>();

/** Every workspace package's scripts by name, and the root's under `''` (read once per tree). */
function packageScripts(repo: Repository): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const cached = scriptsCache.get(repo);
  if (cached !== undefined) {
    return cached;
  }
  const packages = new Map<string, Readonly<Record<string, string>>>();
  const root = repo.exists('package.json') ? readPackage(repo, 'package.json') : null;
  packages.set('', root?.scripts ?? {});
  for (const directory of PACKAGE_DIRECTORIES) {
    for (const file of repo.listFiles(directory)) {
      const depth = file.split('/').length;
      if (file.endsWith('/package.json') && depth <= 3) {
        const parsed = readPackage(repo, file);
        if (parsed !== null && parsed.name !== '') {
          packages.set(parsed.name, parsed.scripts);
        }
      }
    }
  }
  scriptsCache.set(repo, packages);
  return packages;
}

const FILTERED = /^pnpm (?:--filter|-F) (@openverify\/[a-z0-9-]+) ([a-z0-9:-]+)/;
const ROOT_SCRIPT = /^pnpm ([a-z][a-z0-9:-]*)(?:\s|$)/;
/** pnpm's own commands, which a root span may name without a script. */
const PNPM_COMMANDS = new Set([
  'install',
  'add',
  'remove',
  'exec',
  'audit',
  'dlx',
  'run',
  'why',
  'list',
]);

/** A `pnpm --filter @openverify/<package> <script>` (or `pnpm <script>`) whose script is missing. */
export function commandFindings(
  repo: Repository,
  path: string,
  text: string,
): readonly CheckFinding[] {
  const scripts = packageScripts(repo);
  const findings: CheckFinding[] = [];
  for (const span of codeSpans(text)) {
    const filtered = FILTERED.exec(span);
    if (filtered !== null) {
      const [, name = '', script = ''] = filtered;
      const own = scripts.get(name);
      if (own === undefined) {
        findings.push(
          finding('command-exists', path, `cites ${span}: no package is named ${name}`),
        );
      } else if (!Object.hasOwn(own, script)) {
        findings.push(
          finding('command-exists', path, `cites ${span}: ${name} has no script ${script}`),
        );
      }
      continue;
    }
    const root = ROOT_SCRIPT.exec(span);
    if (root !== null && !span.startsWith('pnpm --') && !span.startsWith('pnpm -F')) {
      const script = root[1] ?? '';
      if (!PNPM_COMMANDS.has(script) && !Object.hasOwn(scripts.get('') ?? {}, script)) {
        findings.push(
          finding(
            'command-exists',
            path,
            `cites ${span}: the root package.json has no script ${script}`,
          ),
        );
      }
    }
  }
  return findings;
}

const VARIABLE = /^(?:OPENVERIFY_[A-Z0-9_{}]+|DATABASE_URL|REDIS_URL|S3_[A-Z0-9_]+)(?:_FILE)?$/;

/**
 * Names that look like a process variable and are not one: the release workflow's repository
 * variable (`src/switches.ts`), which no process reads.
 */
const NOT_PROCESS_VARIABLES: ReadonlySet<string> = new Set([PUBLISH_VARIABLE]);

/** Whether `name` is registered: exactly, as a `_FILE` form, or as a pattern entry's name. */
function registered(name: string): boolean {
  if (NOT_PROCESS_VARIABLES.has(name)) {
    return true;
  }
  const exact = CONFIG_REGISTRY.find((entry) => entry.name === name);
  if (exact !== undefined) {
    return true;
  }
  if (name.endsWith('_FILE')) {
    const base = CONFIG_REGISTRY.find((entry) => entry.name === name.slice(0, -'_FILE'.length));
    if (base !== undefined) {
      return base.fileForm;
    }
  }
  return CONFIG_REGISTRY.filter(isPatternEntry).some(
    (entry) =>
      matchesPattern(name, entry.name) ||
      (entry.fileForm && name.endsWith('_FILE') && matchesPattern(name.slice(0, -5), entry.name)),
  );
}

const NAME_CHARACTERS = /^[A-Z0-9_]+$/;

/**
 * Whether `name` is one a pattern entry composes: its fixed parts in order, each `{PLACEHOLDER}`
 * filled by at least one of `A-Z`, `0-9` and `_` (no run-time regular expression, C252).
 */
function matchesPattern(name: string, pattern: string): boolean {
  const parts = pattern.split(/\{[A-Z_]+\}/);
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (parts.length < 2 || !name.startsWith(first) || !name.endsWith(last)) {
    return false;
  }
  let rest = name.slice(first.length, name.length - last.length);
  for (const middle of parts.slice(1, -1)) {
    const at = rest.indexOf(middle, 1);
    if (at < 1 || !NAME_CHARACTERS.test(rest.slice(0, at))) {
      return false;
    }
    rest = rest.slice(at + middle.length);
  }
  return NAME_CHARACTERS.test(rest);
}

/** A configuration variable a code span names that `config-registry.ts` does not hold. */
export function variableFindings(path: string, text: string): readonly CheckFinding[] {
  const unknown = new Set(
    codeSpans(text).filter((span) => VARIABLE.test(span) && !registered(span)),
  );
  return [...unknown].map((name) =>
    finding(
      'variable-registered',
      path,
      `names ${name}, which apps/api/src/config-registry.ts does not hold (or holds without a _FILE form)`,
    ),
  );
}

/** Each required code span the page does not hold, with why it is required. */
export function requiredSpanFindings(
  path: string,
  text: string,
  required: readonly { readonly span: string; readonly why: string }[],
): readonly CheckFinding[] {
  const present = new Set(codeSpans(text));
  return required
    .filter((item) => !present.has(item.span))
    .map((item) => finding('required-entry', path, `does not name \`${item.span}\` (${item.why})`));
}
