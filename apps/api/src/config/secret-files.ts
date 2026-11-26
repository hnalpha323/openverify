/**
 * C249.2 (G-SECRETS; ours): every secret the configuration reads also reads from `<NAME>_FILE`, a
 * path to a mounted file (its trailing newline trimmed). Setting both is a start-up error; a
 * world-readable file is a warning (group read is how a non-root process reads a Kubernetes secret
 * mounted 0440 with fsGroup, so it is not warned).
 *
 * `loadConfig` and `loadMigrateConfig` call `resolveSecretFiles` with the registry before they read
 * anything (foundation-11b's hook; built by platform-ops, Phase 11, Workflow 11B). The `_FILE`
 * names are the registry's entries with `fileForm`, exact names and pattern entries alike
 * (`OPENVERIFY_SEED_{ROLE}_PASSWORD_FILE` matches `OPENVERIFY_SEED_ADMIN_PASSWORD_FILE`). A
 * `_FILE` name no such entry has is left alone: `OPENVERIFY_WORKER_HEARTBEAT_FILE` is a variable
 * of its own. Issues and warnings name variables only, never a value or a file's content.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ConfigVariable } from '../config-registry.js';
import type { StartupWarning } from './startup-warnings.js';

/** What `resolveSecretFiles` answers: the environment to read, and what it found wrong. */
export interface SecretFilesResult {
  /** The environment with each `<NAME>_FILE` resolved into `<NAME>`. */
  readonly env: NodeJS.ProcessEnv;
  /** `<NAME>: <problem>` lines, as `ConfigError` lists them; never a value or a file's content. */
  readonly issues: readonly string[];
  readonly warnings: readonly StartupWarning[];
}

/** The file access `resolveSecretFiles` uses; tests pass a fake. */
export interface SecretFileSystem {
  /** The file's text. */
  readFile(path: string): string;
  /** The file's permission bits (`stat().mode`). */
  mode(path: string): number;
}

const FILE_SUFFIX = '_FILE';
/** `S_IROTH`: readable by every user of the host. */
const WORLD_READABLE = 0o004;

const nodeFiles: SecretFileSystem = {
  readFile: (path) => readFileSync(path, 'utf8'),
  mode: (path) => statSync(path).mode,
};

/**
 * Whether `name` is one of the names a pattern entry composes: its fixed parts in order, each
 * `{PLACEHOLDER}` one or more of A-Z, 0-9 and `_`. Matched by hand: a name never becomes a pattern.
 */
function composes(pattern: string, name: string): boolean {
  const parts: string[] = [];
  let rest = pattern;
  while (rest.includes('{')) {
    const open = rest.indexOf('{');
    const close = rest.indexOf('}', open);
    if (close === -1) {
      return false;
    }
    parts.push(rest.slice(0, open));
    rest = rest.slice(close + 1);
  }
  parts.push(rest);
  const [first = '', ...inner] = parts;
  const last = inner.pop() ?? '';
  if (!name.startsWith(first) || !name.endsWith(last) || name.length < first.length + last.length) {
    return false;
  }
  let middle = name.slice(first.length, name.length - last.length);
  for (const fixed of [...inner, '']) {
    const at = fixed === '' ? middle.length : middle.indexOf(fixed, 1);
    const gap = middle.slice(0, at);
    if (at < 1 || !/^[A-Z0-9_]+$/.test(gap)) {
      return false;
    }
    middle = middle.slice(at + fixed.length);
  }
  return true;
}

/** The secret `<NAME>` a `<NAME>_FILE` reads into, when a `fileForm` entry has it. */
function secretOf(fileName: string, registry: readonly ConfigVariable[]): string | null {
  if (!fileName.endsWith(FILE_SUFFIX)) {
    return null;
  }
  const name = fileName.slice(0, -FILE_SUFFIX.length);
  const entry = registry.find(
    (candidate) =>
      candidate.fileForm &&
      (candidate.prefix === undefined ? candidate.name === name : composes(candidate.name, name)),
  );
  return entry === undefined ? null : name;
}

/** The text without its trailing line ends (`\n` or `\r\n`, any number); spaces are kept. */
function withoutTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Resolves the `<NAME>_FILE` form of every registry entry with `fileForm` (pattern entries
 * included, matched against the environment's names).
 */
export function resolveSecretFiles(
  env: NodeJS.ProcessEnv,
  registry: readonly ConfigVariable[],
  files: SecretFileSystem = nodeFiles,
): SecretFilesResult {
  const issues: string[] = [];
  const warnings: StartupWarning[] = [];
  const resolved: Record<string, string> = {};
  for (const [fileName, path] of Object.entries(env)) {
    const name = secretOf(fileName, registry);
    if (name === null || path === undefined || path.trim() === '') {
      continue;
    }
    if ((env[name] ?? '') !== '') {
      issues.push(`${name}: is set together with ${fileName}; set one`);
      continue;
    }
    if (!isAbsolute(path)) {
      issues.push(`${fileName}: must be an absolute path`);
      continue;
    }
    let text: string;
    let mode: number;
    try {
      text = withoutTrailingNewlines(files.readFile(path));
      mode = files.mode(path);
    } catch {
      issues.push(`${fileName}: cannot be read`);
      continue;
    }
    if (text === '') {
      issues.push(`${fileName}: is empty`);
      continue;
    }
    if ((mode & WORLD_READABLE) !== 0) {
      warnings.push({
        code: 'secret_file_readable',
        variable: fileName,
        reason: `${fileName} is readable by every user of the host; mount it 0400, or 0440 with the process’s group`,
      });
    }
    resolved[name] = text;
  }
  return {
    env: Object.keys(resolved).length === 0 ? env : { ...env, ...resolved },
    issues,
    warnings,
  };
}
