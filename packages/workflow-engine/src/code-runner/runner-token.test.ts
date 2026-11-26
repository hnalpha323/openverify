import { describe, expect, it } from 'vitest';
import { readCodeRunnerToken, type TokenFileSystem } from './runner-token.js';

// C263.6, C249.2 (Phase 11, Workflow 11C, images-11c; orchestrator decision 18): the runner reads
// OPENVERIFY_CODE_RUNNER_TOKEN or OPENVERIFY_CODE_RUNNER_TOKEN_FILE with the API's rules, and never
// names the value.
const NAME = 'OPENVERIFY_CODE_RUNNER_TOKEN';
const FILE = `${NAME}_FILE`;
const TOKEN = 'synthetic-runner-token-0123456789abcdef';

const files = (entries: Record<string, { text: string; mode?: number }>): TokenFileSystem => ({
  readFile: (path) => {
    const entry = entries[path];
    if (entry === undefined) throw new Error(`ENOENT: ${path}`);
    return entry.text;
  },
  mode: (path) => entries[path]?.mode ?? 0o100440,
});

describe("the runner's token (C263.6, C249.2)", () => {
  it('reads the variable, or the file with its trailing line ends trimmed', () => {
    expect(readCodeRunnerToken({ [NAME]: TOKEN }, files({}))).toEqual({
      token: TOKEN,
      issues: [],
      warnings: [],
    });
    expect(
      readCodeRunnerToken(
        { [FILE]: '/run/secrets/openverify/token' },
        files({ '/run/secrets/openverify/token': { text: `${TOKEN}\r\n` } }),
      ),
    ).toEqual({ token: TOKEN, issues: [], warnings: [] });
  });

  it('answers no token when neither is set (the socket form needs none)', () => {
    expect(readCodeRunnerToken({}, files({}))).toEqual({ token: null, issues: [], warnings: [] });
  });

  it.each([
    [{ [NAME]: TOKEN, [FILE]: '/t' }, `${NAME}: is set together with ${FILE}; set one`],
    [{ [FILE]: 'token' }, `${FILE}: must be an absolute path`],
    [{ [FILE]: '/missing' }, `${FILE}: cannot be read`],
    [{ [FILE]: '/empty' }, `${FILE}: is empty`],
    [{ [NAME]: 'synthetic-short' }, `${NAME}: must be at least 32 bytes`],
  ])('refuses %j, naming the variable and never the value', (env, issue) => {
    const result = readCodeRunnerToken(
      env,
      files({ '/t': { text: TOKEN }, '/empty': { text: '\n' } }),
    );
    expect(result.token).toBeNull();
    expect(result.issues).toEqual([issue]);
    expect(JSON.stringify(result.issues)).not.toContain('synthetic');
  });

  it('warns about a world-readable file, not about a group-readable one', () => {
    const read = (mode: number) =>
      readCodeRunnerToken({ [FILE]: '/t' }, files({ '/t': { text: TOKEN, mode } }));
    expect(read(0o100440).warnings).toEqual([]);
    expect(read(0o100444)).toEqual({
      token: TOKEN,
      issues: [],
      warnings: [{ event: 'secret_file_readable', variable: FILE }],
    });
  });
});
