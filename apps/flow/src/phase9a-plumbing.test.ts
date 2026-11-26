// @vitest-environment node
/**
 * Workflow 9A Stage 1b, checkpoint (F): what `foundation-9a` builds in the flow app (C156.2,
 * C157.1, C158.1, C159; reviews F10, F11, F12; V04):
 *
 * - the import-free `src/security/csp-policy.ts`, shared by the Vite build and the flow server;
 * - the flow server's skeleton `server.ts`, run by Node from source with
 *   `--conditions=@openverify/source`, importing `@openverify/contracts/origin-pattern` (V04), and
 *   its own `tsconfig.server.json` (`allowImportingTsExtensions`) in the typecheck;
 * - `preview.html` as its own Vite build input, its entry a stub in `src/preview/`;
 * - the embed slots: the `/embed/:inquiryId` route in `routes.tsx` and the bridge in `main.tsx`,
 *   each mounting a stub in `src/embed/`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FLOW_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(`${FLOW_ROOT}${path}`, 'utf8');

describe('the shared policy module (C157.1; reviews F10, F12)', () => {
  it('imports nothing, so Vite and Node load it alike', () => {
    expect(read('src/security/csp-policy.ts')).not.toMatch(/^\s*(import|export .* from)\s/m);
  });

  it('is what the build and the flow server compute the policy with', () => {
    expect(read('src/security/security-meta.ts')).toContain("from './csp-policy'");
    expect(read('server.ts')).toContain("from './src/security/csp-policy.ts'");
  });
});

describe('the flow server skeleton (C157.1, C158.1; V04)', () => {
  it('answers --help from source, importing the origin module through its subpath', () => {
    const run = spawnSync(
      process.execPath,
      ['--conditions=@openverify/source', 'server.ts', '--help'],
      { cwd: FLOW_ROOT, encoding: 'utf8', timeout: 30_000 },
    );

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(
      /^Usage: node --conditions=@openverify\/source apps\/flow\/server\.ts/,
    );
    // Read from MAX_ORIGIN_ENTRIES, so the subpath import ran.
    expect(run.stdout).toContain('at most 50 embed origins');
    expect(read('server.ts')).toContain("from '@openverify/contracts/origin-pattern'");
  });

  it('is type-checked with its own configuration, which allows .ts specifiers', () => {
    const config = JSON.parse(read('tsconfig.server.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;

    expect(config.compilerOptions.allowImportingTsExtensions).toBe(true);
    expect(config.include).toContain('server.ts');
    expect(scripts.typecheck).toContain('tsc --noEmit -p tsconfig.server.json');
  });
});

describe('the preview entry (C156.2, C156.3)', () => {
  it('is its own build input, apart from the hosted flow', async () => {
    const { default: config } = await import('../vite.config');
    const resolved =
      typeof config === 'function'
        ? config({ command: 'build', mode: 'test', isSsrBuild: false, isPreview: false })
        : config;

    expect(resolved.build?.rolldownOptions?.input).toEqual({
      main: `${FLOW_ROOT}index.html`,
      preview: `${FLOW_ROOT}preview.html`,
    });
    expect(read('preview.html')).toContain('src="/src/preview/main.tsx"');
  });
});

describe('the embed slots (C157.1, C159.4)', () => {
  it('mount the stubs of src/embed/ from the routes and the entry', () => {
    expect(read('src/routes.tsx')).toMatch(/<Route\s+path="embed\/:inquiryId"/);
    expect(read('src/main.tsx')).toContain("import { mountEmbedBridge } from './embed/bridge';");
    expect(read('src/main.tsx')).toMatch(/mountEmbedBridge\(window\)/);
  });
});
