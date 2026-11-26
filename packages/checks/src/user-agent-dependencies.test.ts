import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * C94.5 (Phase 7): the user agent is parsed with `bowser` 2.14.1 (MIT), a direct dependency of
 * `@openverify/checks` through the pnpm catalog. `ua-parser-js` 2.x is AGPL, and FingerprintJS
 * 4.x is BSL; CLAUDE.md rule 4 keeps both out of the install (THIRD_PARTY_LICENSES.md).
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');

describe('the user-agent parser and the excluded fingerprinting libraries', () => {
  it('takes bowser 2.14.1 from the catalog, as a direct dependency of checks', () => {
    expect(read('pnpm-workspace.yaml')).toMatch(/^ {2}bowser: 2\.14\.1$/m);
    const manifest = JSON.parse(read('packages/checks/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.bowser).toBe('catalog:');
  });

  it('has no ua-parser-js 2.x and no FingerprintJS 4.x or later in the lockfile', () => {
    const lockfile = read('pnpm-lock.yaml');
    expect(lockfile).not.toMatch(/^\s+'?ua-parser-js@[2-9]\./m);
    expect(lockfile).not.toMatch(/^\s+'?@fingerprintjs\/fingerprintjs@[4]\./m);
  });
});
