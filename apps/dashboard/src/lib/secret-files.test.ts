import { describe, expect, it } from 'vitest';
import { resolveSecretFiles, type SecretFileSystem } from './secret-files';

// C249.2 for the console's custom server (Phase 11, Workflow 11C, images-11c; orchestrator decision 18): the
// API's rules (apps/api/src/config/secret-files.ts) for OPENVERIFY_DASHBOARD_BFF_TOKEN_FILE.
const NAME = 'OPENVERIFY_DASHBOARD_BFF_TOKEN';
const FILE = `${NAME}_FILE`;
const TOKEN = 'synthetic-dashboard-bff-token-0123456789abcdef';

function files(entries: Record<string, { text: string; mode?: number }>): SecretFileSystem {
  const find = (path: string) => {
    const entry = entries[path];
    if (entry === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return entry;
  };
  return {
    readFile: (path) => find(path).text,
    mode: (path) => find(path).mode ?? 0o100440,
  };
}

describe('the console reads its secrets from files too (C249.2)', () => {
  it('reads <NAME>_FILE into <NAME>, trailing line ends trimmed and spaces kept', () => {
    const result = resolveSecretFiles(
      { [FILE]: '/run/secrets/openverify/token', OTHER: 'kept' },
      [NAME],
      files({ '/run/secrets/openverify/token': { text: ` ${TOKEN} \r\n\n` } }),
    );
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.env[NAME]).toBe(` ${TOKEN} `);
    expect(result.env.OTHER).toBe('kept');
  });

  it('leaves the environment alone without a file form, or with an empty one', () => {
    const env = { [NAME]: TOKEN, [FILE]: '  ' };
    const result = resolveSecretFiles(env, [NAME], files({}));
    expect(result).toEqual({ env, issues: [], warnings: [] });
  });

  it.each([
    [{ [NAME]: TOKEN, [FILE]: '/token' }, `${NAME}: is set together with ${FILE}; set one`],
    [{ [FILE]: 'token' }, `${FILE}: must be an absolute path`],
    [{ [FILE]: '/missing' }, `${FILE}: cannot be read`],
    [{ [FILE]: '/empty' }, `${FILE}: is empty`],
  ])('refuses %j, naming the variable and never the value', (env, issue) => {
    const result = resolveSecretFiles(
      env,
      [NAME],
      files({ '/token': { text: TOKEN }, '/empty': { text: '\n' } }),
    );
    expect(result.issues).toEqual([issue]);
    expect(JSON.stringify(result.issues)).not.toContain(TOKEN);
  });

  it('warns about a world-readable file, not about a group-readable one', () => {
    const read = (mode: number) =>
      resolveSecretFiles({ [FILE]: '/token' }, [NAME], files({ '/token': { text: TOKEN, mode } }));
    expect(read(0o100440).warnings).toEqual([]);
    expect(read(0o100444).warnings).toEqual([{ event: 'secret_file_readable', variable: FILE }]);
    expect(read(0o100444).env[NAME]).toBe(TOKEN);
  });
});
