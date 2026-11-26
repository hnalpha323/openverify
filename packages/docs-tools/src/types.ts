/**
 * The shapes every area of `@openverify/docs-tools` shares (Workflow 11E Stage 1a, contracts-11e).
 * A generator reads the repository through a {@link Repository} and returns the files it would
 * write; only the CLI (`src/cli.ts`, the package scripts) writes them, so a test never changes the
 * working tree (Workflow 10A rule 21). A check returns findings; it never writes either.
 */

/** The six areas of Workflow 11E's Stage 2, one directory each under `src/`. */
export const DOCS_AREAS = [
  'security',
  'records',
  'selfhost',
  'compliance',
  'catalog',
  'release',
] as const;
export type DocsArea = (typeof DOCS_AREAS)[number];

/** The agent that owns each area's generators and checks (the plan's "Workflow 11E" bullets). */
export const AREA_OWNERS: Readonly<Record<DocsArea, string>> = Object.freeze({
  security: 'docs-security',
  records: 'docs-records',
  selfhost: 'docs-selfhost',
  compliance: 'docs-compliance',
  catalog: 'docs-catalog',
  release: 'docs-release',
});

/** The contracts each area meets. */
export const AREA_CONTRACTS: Readonly<Record<DocsArea, readonly string[]>> = Object.freeze({
  security: ['C273', 'C274', 'C275'],
  records: ['C276'],
  selfhost: ['C277'],
  compliance: ['C278'],
  catalog: ['C279', 'C280', 'C281'],
  release: ['C284'],
});

/** Read-only access to the repository (or to a fixture tree), by repository-relative path. */
export interface Repository {
  /** An absolute path for the real tree, or a label such as `memory:` for a fixture. */
  readonly root: string;
  /** Whether a file (not a directory) exists at `path`. */
  exists(path: string): boolean;
  /** The file's text (UTF-8); throws when it does not exist. */
  readText(path: string): string;
  /**
   * Every file under `dir` (recursive), as repository-relative paths with `/`, sorted; build,
   * install and cache directories are skipped. An absent directory lists nothing.
   */
  listFiles(dir: string): readonly string[];
}

/** One file a generator renders, at its repository-relative path, exactly as it is committed. */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

/** `built` once the area's owner fills it; a stub answers `not-built`. */
export type BuildStatus = 'built' | 'not-built';

/** What one area's render produces. */
export interface RenderResult {
  readonly area: DocsArea;
  readonly status: BuildStatus;
  readonly files: readonly GeneratedFile[];
}

/**
 * One problem a check found. `error` fails the check; `owner` is an item only the owner can close,
 * reported with its state (release:check's default mode exits 0 while only those remain, C284.2).
 */
export interface CheckFinding {
  readonly rule: string;
  readonly path: string;
  readonly line?: number;
  readonly message: string;
  readonly severity: 'error' | 'owner';
}

/** What one check found. */
export interface CheckResult {
  readonly name: string;
  readonly status: BuildStatus;
  readonly findings: readonly CheckFinding[];
}
