/**
 * C263.6, C249.2 (Phase 11, Workflow 11C, images-11c; orchestrator decision 18): the runner's own
 * read of `OPENVERIFY_CODE_RUNNER_TOKEN` or its `_FILE` form, with the API's rules
 * (`apps/api/src/config/secret-files.ts`): both forms set, a relative path, an unreadable or an
 * empty file are issues; the trailing line ends are trimmed; a world-readable file is the warning
 * `secret_file_readable`; a token under 32 bytes is an issue. Issues and warnings name variables,
 * never a value. The worker reads the same variable through `apps/api/src/config.ts`.
 */
import { CODE_RUNNER_TOKEN_MIN_BYTES, CODE_RUNNER_TOKEN_VARIABLE } from './transport.js';

/** The file access `readCodeRunnerToken` uses; the entry passes `node:fs`, tests a fake. */
export interface TokenFileSystem {
  readFile(path: string): string;
  mode(path: string): number;
}

export interface CodeRunnerTokenResult {
  /** `null` when unset (the socket form needs none) or refused. */
  readonly token: string | null;
  readonly issues: readonly string[];
  readonly warnings: readonly {
    readonly event: 'secret_file_readable';
    readonly variable: string;
  }[];
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

const refused = (issue: string): CodeRunnerTokenResult => ({
  token: null,
  issues: [issue],
  warnings: [],
});

/** The token from the environment or its file. */
export function readCodeRunnerToken(
  env: Readonly<Record<string, string | undefined>>,
  files: TokenFileSystem,
): CodeRunnerTokenResult {
  const name = CODE_RUNNER_TOKEN_VARIABLE;
  const fileName = `${name}_FILE`;
  const path = env[fileName]?.trim() ?? '';
  const direct = env[name] ?? '';
  const warnings: CodeRunnerTokenResult['warnings'][number][] = [];
  let token: string;
  if (path === '') {
    if (direct.trim() === '') {
      return { token: null, issues: [], warnings: [] };
    }
    token = direct.trim();
  } else {
    if (direct !== '') {
      return refused(`${name}: is set together with ${fileName}; set one`);
    }
    if (!path.startsWith('/')) {
      return refused(`${fileName}: must be an absolute path`);
    }
    let mode: number;
    try {
      token = withoutTrailingNewlines(files.readFile(path));
      mode = files.mode(path);
    } catch {
      return refused(`${fileName}: cannot be read`);
    }
    if (token.length === 0) {
      return refused(`${fileName}: is empty`);
    }
    if ((mode & WORLD_READABLE) !== 0) {
      warnings.push({ event: 'secret_file_readable', variable: fileName });
    }
  }
  if (Buffer.byteLength(token, 'utf8') < CODE_RUNNER_TOKEN_MIN_BYTES) {
    return refused(`${name}: must be at least ${String(CODE_RUNNER_TOKEN_MIN_BYTES)} bytes`);
  }
  return { token, issues: [], warnings };
}
