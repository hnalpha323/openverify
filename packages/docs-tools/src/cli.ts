/**
 * The package scripts' entry point (contracts-11e): `render <area|all>` writes an area's generated
 * files (the only writer, Workflow 10A rule 21); `release-check [--tag]` runs C284.2's check.
 *
 * `stubs` writes the docs tree's missing files as stubs (contracts-11e, Stage 1a). `routes` collects
 * the API's route table into `docs/api/route-table.json`, the catalog's committed input
 * (integration-11e; `docs:catalog` runs it before `render catalog`).
 *
 * Exit codes: 0 done; 1 a check failed; 2 a usage error; 3 an entry point its owner has not built
 * yet (a stub never passes for a built one).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, type AreaEntryPoints } from './areas.js';
import { renderRouteTable } from './catalog/index.js';
import { missingFromTree, stubFor } from './docs-tree.js';
import {
  releaseCheck as realReleaseCheck,
  type ReleaseCheckOptions,
  type ReleaseCheckResult,
} from './release/index.js';
import { staleAwareReleaseCheck } from './integration/index.js';
import { REPOSITORY_ROOT, createRepository } from './repository.js';
import { createGitEvidenceHistory } from './security/index.js';
import {
  AREA_OWNERS,
  DOCS_AREAS,
  type DocsArea,
  type GeneratedFile,
  type Repository,
} from './types.js';

/** What the CLI touches, injected so a test runs it without writing the tree. */
export interface CliDeps {
  readonly repo: Repository;
  readonly write: (path: string, content: string) => void;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The areas' entry points; the real ones by default (a test injects built ones). */
  readonly areas?: Partial<Record<DocsArea, AreaEntryPoints>>;
  /** C284.2's check; the real one by default. */
  readonly releaseCheck?: (repo: Repository, options: ReleaseCheckOptions) => ReleaseCheckResult;
  /** C279.3's route table collector, for the `routes` command; the real one by default. */
  readonly routes?: (root: string) => GeneratedFile;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_BUILT = 3;

const USAGE = [
  'usage: docs-tools render <security|records|selfhost|compliance|catalog|release|all>',
  '       docs-tools routes',
  '       docs-tools release-check [--tag]',
  '       docs-tools stubs',
].join('\n');

const isArea = (value: string): value is DocsArea =>
  (DOCS_AREAS as readonly string[]).includes(value);

/** Whether `file` stays inside the repository (no absolute path, no `..` part). */
function insideRepository(file: string): boolean {
  const normalised = path.posix.normalize(file.replaceAll('\\', '/'));
  return !path.posix.isAbsolute(normalised) && normalised !== '..' && !normalised.startsWith('../');
}

/** Renders one area and writes its files; returns that area's exit code. */
function renderArea(area: DocsArea, deps: CliDeps): number {
  const entry = deps.areas?.[area] ?? AREAS[area];
  const result = entry.render(deps.repo);
  if (result.status === 'not-built') {
    deps.err(`${area}: not built yet (${AREA_OWNERS[area]})`);
    return EXIT_NOT_BUILT;
  }
  if (result.area !== area) {
    deps.err(`${area}: the render answered for ${result.area}; nothing written`);
    return EXIT_FAILED;
  }
  const outside = result.files.filter((file) => !insideRepository(file.path));
  if (outside.length > 0) {
    deps.err(
      `${area}: paths outside the repository: ${outside.map((file) => file.path).join(', ')}`,
    );
    return EXIT_FAILED;
  }
  const files = [...result.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of files) {
    deps.write(file.path, file.content);
  }
  deps.out(`${area}: ${String(files.length)} files written`);
  return EXIT_OK;
}

function render(target: string, deps: CliDeps): number {
  if (target === 'all') {
    return DOCS_AREAS.map((area) => renderArea(area, deps)).reduce((a, b) => Math.max(a, b), 0);
  }
  return isArea(target) ? renderArea(target, deps) : usage(deps);
}

function runReleaseCheck(options: ReleaseCheckOptions, deps: CliDeps): number {
  const result = (deps.releaseCheck ?? realReleaseCheck)(deps.repo, options);
  if (result.status === 'not-built') {
    deps.err(`release:check: not built yet (${AREA_OWNERS.release})`);
    return EXIT_NOT_BUILT;
  }
  const errors = result.findings.filter((finding) => finding.severity === 'error');
  const owners = result.findings.filter((finding) => finding.severity === 'owner');
  for (const finding of result.findings) {
    const where =
      finding.line === undefined ? finding.path : `${finding.path}:${String(finding.line)}`;
    const line = `${finding.severity} ${where} ${finding.rule}: ${finding.message}`;
    (finding.severity === 'error' ? deps.err : deps.out)(line);
  }
  deps.out(
    `release:check (${result.mode}): ${String(errors.length)} errors, ${String(owners.length)} owner items`,
  );
  return errors.length > 0 || (options.tag && owners.length > 0) ? EXIT_FAILED : EXIT_OK;
}

/** Collects the API's route table and writes `docs/api/route-table.json` (C279.3's input). */
function writeRoutes(deps: CliDeps): number {
  const file = (deps.routes ?? renderRouteTable)(deps.repo.root);
  deps.write(file.path, file.content);
  deps.out('routes: 1 files written');
  return EXIT_OK;
}

/** Writes a stub for each docs-tree path that does not exist yet; never over an existing file. */
function writeStubs(deps: CliDeps): number {
  const missing = missingFromTree(deps.repo);
  for (const item of missing) {
    deps.write(item.path, stubFor(item));
  }
  deps.out(`stubs: ${String(missing.length)} written`);
  return EXIT_OK;
}

function usage(deps: Pick<CliDeps, 'err'>): number {
  deps.err(USAGE);
  return EXIT_USAGE;
}

/** Runs one command; returns its exit code. */
export function runCli(argv: readonly string[], deps: CliDeps): number {
  const [command, ...rest] = argv;
  if (command === 'render' && rest.length === 1 && rest[0] !== undefined) {
    return render(rest[0], deps);
  }
  if (command === 'routes' && rest.length === 0) {
    return writeRoutes(deps);
  }
  if (command === 'stubs' && rest.length === 0) {
    return writeStubs(deps);
  }
  if (command === 'release-check' && rest.every((arg) => arg === '--tag') && rest.length <= 1) {
    return runReleaseCheck({ tag: rest.length === 1 }, deps);
  }
  return usage(deps);
}

/**
 * The process entry: the real tree, the real writer, `process.argv`, and release:check with
 * C274.6's staleness read from the real tree's git history (integration-11e).
 */
export function main(
  argv: readonly string[] = process.argv.slice(2),
  io: Partial<Pick<CliDeps, 'out' | 'err'>> = {},
): number {
  return runCli(argv, {
    repo: createRepository(REPOSITORY_ROOT),
    write: (file, content) => {
      const target = path.join(REPOSITORY_ROOT, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    out: io.out ?? ((line) => process.stdout.write(`${line}\n`)),
    err: io.err ?? ((line) => process.stderr.write(`${line}\n`)),
    releaseCheck: staleAwareReleaseCheck(createGitEvidenceHistory(REPOSITORY_ROOT)),
  });
}

/* v8 ignore next 3 -- the script entry: the package scripts run it, the tests call main() */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
