/**
 * C249.2 (G-SECRETS; Phase 11, Workflow 11B, platform-ops): every secret the configuration reads
 * also reads from `<NAME>_FILE`, a path to a mounted file, its trailing newline trimmed; the
 * provider and seed secrets through the registry's pattern entries. Setting both is a start-up
 * error; a world-readable file is a warning, a group-readable one is not (review P18). No issue or
 * warning carries a value or a file's content. Every value is a synthetic canary.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_REGISTRY, type ConfigVariable } from '../config-registry.js';
import { resolveSecretFiles, type SecretFileSystem } from './secret-files.js';

const CANARY = 'change-me-synthetic-secret-canary-0123456789';

/** A file system of `path: [text, mode]`; a missing path cannot be read. */
function files(entries: Record<string, readonly [string, number]>): SecretFileSystem {
  const find = (path: string) => {
    const entry = entries[path];
    if (entry === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    }
    return entry;
  };
  return { readFile: (path) => find(path)[0], mode: (path) => find(path)[1] };
}

const registry: readonly ConfigVariable[] = [
  {
    name: 'OPENVERIFY_KEK',
    description: 'k',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_MODE',
    description: 'm',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_SEED_{ROLE}_PASSWORD',
    prefix: 'OPENVERIFY_SEED_',
    description: 'p',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['migrate'],
  },
];

describe('resolveSecretFiles (C249.2)', () => {
  it('reads <NAME>_FILE into <NAME>, trimming the trailing newline only', () => {
    const result = resolveSecretFiles(
      { OPENVERIFY_KEK_FILE: '/run/secrets/kek', OPENVERIFY_MODE: 'production' },
      registry,
      files({ '/run/secrets/kek': [` ${CANARY}\n\n`, 0o100400] }),
    );

    expect(result.env.OPENVERIFY_KEK).toBe(` ${CANARY}`);
    expect(result.env.OPENVERIFY_MODE).toBe('production');
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('trims a Windows line end too', () => {
    const result = resolveSecretFiles(
      { OPENVERIFY_KEK_FILE: '/run/secrets/kek' },
      registry,
      files({ '/run/secrets/kek': [`${CANARY}\r\n`, 0o100440] }),
    );

    expect(result.env.OPENVERIFY_KEK).toBe(CANARY);
  });

  it('reads the pattern entries’ _FILE forms', () => {
    const result = resolveSecretFiles(
      {
        OPENVERIFY_SEED_ADMIN_PASSWORD_FILE: '/run/secrets/admin',
        OPENVERIFY_SEED_MFA_ADMIN_PASSWORD_FILE: '/run/secrets/mfa',
      },
      registry,
      files({
        '/run/secrets/admin': [`${CANARY}-admin\n`, 0o100400],
        '/run/secrets/mfa': [`${CANARY}-mfa\n`, 0o100400],
      }),
    );

    expect(result.env.OPENVERIFY_SEED_ADMIN_PASSWORD).toBe(`${CANARY}-admin`);
    expect(result.env.OPENVERIFY_SEED_MFA_ADMIN_PASSWORD).toBe(`${CANARY}-mfa`);
    expect(result.issues).toEqual([]);
  });

  it('leaves a _FILE name that no secret entry has alone', () => {
    const env = {
      OPENVERIFY_MODE_FILE: '/run/x',
      OPENVERIFY_WORKER_HEARTBEAT_FILE: '/tmp/hb',
      OPENVERIFY_SEED__PASSWORD_FILE: '/run/empty-role',
    };

    const result = resolveSecretFiles(env, registry, files({}));

    expect(result.env).toEqual(env);
    expect(result.issues).toEqual([]);
  });

  it('refuses a secret set both ways, naming the two variables and no value', () => {
    const result = resolveSecretFiles(
      { OPENVERIFY_KEK: CANARY, OPENVERIFY_KEK_FILE: '/run/secrets/kek' },
      registry,
      files({ '/run/secrets/kek': [`${CANARY}-file\n`, 0o100400] }),
    );

    expect(result.issues).toEqual([
      'OPENVERIFY_KEK: is set together with OPENVERIFY_KEK_FILE; set one',
    ]);
    expect(JSON.stringify(result.issues)).not.toContain('canary');
  });

  it.each([
    ['relative/kek', {}, 'OPENVERIFY_KEK_FILE: must be an absolute path'],
    ['/run/secrets/missing', {}, 'OPENVERIFY_KEK_FILE: cannot be read'],
    [
      '/run/secrets/empty',
      { '/run/secrets/empty': ['\n', 0o100400] as const },
      'OPENVERIFY_KEK_FILE: is empty',
    ],
  ])('refuses %s with one issue', (path, entries, issue) => {
    const result = resolveSecretFiles({ OPENVERIFY_KEK_FILE: path }, registry, files(entries));

    expect(result.issues).toEqual([issue]);
    expect(result.env.OPENVERIFY_KEK).toBeUndefined();
  });

  it('warns about a world-readable file, never a group-readable one', () => {
    const world = resolveSecretFiles(
      { OPENVERIFY_KEK_FILE: '/run/secrets/kek' },
      registry,
      files({ '/run/secrets/kek': [CANARY, 0o100644] }),
    );
    const group = resolveSecretFiles(
      { OPENVERIFY_KEK_FILE: '/run/secrets/kek' },
      registry,
      files({ '/run/secrets/kek': [CANARY, 0o100440] }),
    );

    expect(world.warnings).toEqual([
      {
        code: 'secret_file_readable',
        variable: 'OPENVERIFY_KEK_FILE',
        reason:
          'OPENVERIFY_KEK_FILE is readable by every user of the host; mount it 0400, or 0440 with the process’s group',
      },
    ]);
    expect(world.env.OPENVERIFY_KEK).toBe(CANARY);
    expect(group.warnings).toEqual([]);
  });

  it('returns the environment unchanged when no _FILE form is set', () => {
    const env = { OPENVERIFY_KEK: CANARY };

    expect(resolveSecretFiles(env, registry, files({})).env).toBe(env);
  });

  it('covers every secret of the registry the API, the worker and migrate read', () => {
    const served = CONFIG_REGISTRY.filter(
      (entry) =>
        entry.secret &&
        entry.processes.some((process) => ['api', 'worker', 'migrate'].includes(process)),
    );

    expect(served.length).toBeGreaterThan(10);
    for (const entry of served) {
      expect(entry.fileForm, entry.name).toBe(true);
    }
    const play = resolveSecretFiles(
      { OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_FILE: '/run/secrets/play' },
      CONFIG_REGISTRY,
      files({ '/run/secrets/play': ['{"type":"service_account"}\n', 0o100400] }),
    );
    expect(play.env.OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON).toBe(
      '{"type":"service_account"}',
    );
  });

  it('reads a real mounted file and its mode by default', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openverify-secret-file-'));
    try {
      const path = join(directory, 'kek');
      writeFileSync(path, `${CANARY}\n`);
      chmodSync(path, 0o604);

      const result = resolveSecretFiles({ OPENVERIFY_KEK_FILE: path }, registry);

      expect(result.env.OPENVERIFY_KEK).toBe(CANARY);
      expect(result.warnings.map((warning) => warning.code)).toEqual(['secret_file_readable']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
