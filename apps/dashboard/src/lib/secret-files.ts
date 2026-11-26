/**
 * C249.2 for the console's custom server (Phase 11, Workflow 11C, images-11c; orchestrator
 * decision 18; plan, Workflow 11C Stage 1a amendment 13): each secret the console reads,
 * `OPENVERIFY_DASHBOARD_BFF_TOKEN`, is also read from `<NAME>_FILE`, a path to a mounted file, with the API's rules
 * (`apps/api/src/config/secret-files.ts`): setting both, a relative path, an unreadable or an empty
 * file are issues that stop the start; the trailing line ends are trimmed; a world-readable file is
 * the warning `secret_file_readable` (group read is how the chart's 0440 mount with `fsGroup` is
 * read, so it is not warned). Issues and warnings name variables, never a value.
 *
 * Erasable TypeScript and no import: the custom server (`server.ts`), run by Node's type
 * stripping, imports it and passes `node:fs` in.
 */

/** The file access `resolveSecretFiles` uses; the custom server passes `node:fs`, tests a fake. */
export interface SecretFileSystem {
  /** The file's text. */
  readFile(path: string): string;
  /** The file's permission bits (`stat().mode`). */
  mode(path: string): number;
}

/** A warning the custom server logs as one JSON line. */
export interface SecretFileWarning {
  readonly event: 'secret_file_readable';
  readonly variable: string;
}

export interface SecretFilesResult {
  /** The environment with each `<NAME>_FILE` resolved into `<NAME>`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `<NAME>: <problem>` lines; never a value or a file's content. */
  readonly issues: readonly string[];
  readonly warnings: readonly SecretFileWarning[];
}

/** `S_IROTH`: readable by every user of the host. */
const WORLD_READABLE = 0o004;

/** The text without its trailing line ends (`\n` or `\r\n`, any number); spaces are kept. */
function withoutTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) {
    end -= 1;
  }
  return text.slice(0, end);
}

/** Resolves `<NAME>_FILE` of each of `names` (the images run on Linux: absolute means `/…`). */
export function resolveSecretFiles(
  env: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
  files: SecretFileSystem,
): SecretFilesResult {
  const issues: string[] = [];
  const warnings: SecretFileWarning[] = [];
  const resolved: Record<string, string> = {};
  for (const name of names) {
    const fileName = `${name}_FILE`;
    const path = env[fileName]?.trim() ?? '';
    if (path === '') {
      continue;
    }
    if ((env[name] ?? '') !== '') {
      issues.push(`${name}: is set together with ${fileName}; set one`);
      continue;
    }
    if (!path.startsWith('/')) {
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
      warnings.push({ event: 'secret_file_readable', variable: fileName });
    }
    resolved[name] = text;
  }
  return {
    env: Object.keys(resolved).length === 0 ? env : { ...env, ...resolved },
    issues,
    warnings,
  };
}
