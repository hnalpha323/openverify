// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `sharp` is an optional dependency of Next.js used only by the image optimizer, which this
 * app turns off (`images.unoptimized`). Its prebuilt binaries bundle libvips, which is LGPL,
 * and CLAUDE.md rule 4 keeps LGPL code out of everything but `android/openverify-nfc`.
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');

describe('sharp stays out of the install', () => {
  it('is listed in ignoredOptionalDependencies', () => {
    expect(read('pnpm-workspace.yaml')).toMatch(
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      /^ignoredOptionalDependencies:\n(?:\s+- .+\n)*\s+- sharp\n/m,
    );
  });

  it('has no sharp or libvips package in the lockfile', () => {
    const lockfile = read('pnpm-lock.yaml');

    expect(lockfile).not.toMatch(/^\s+'?sharp@/m);
    expect(lockfile).not.toMatch(/^\s+'?@img\/sharp-/m);
  });
});
