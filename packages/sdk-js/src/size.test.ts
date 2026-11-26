// @vitest-environment node
/**
 * C159.1: the client is at most 6 KB gzipped, in both builds. The library build runs through the
 * package's own `vite.config.ts` into a fresh directory of its own, never into `dist/`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/** C159.1: the budget, gzipped. */
const BUDGET_BYTES = 6 * 1024;

describe('the size budget (C159.1)', () => {
  it('keeps the ESM and the IIFE builds within 6 KB gzipped, with no dependency bundled in', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'openverify-js-size-'));
    try {
      await build({
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, sourcemap: false },
      });
      for (const file of ['index.js', 'openverify.iife.js']) {
        const code = readFileSync(join(outDir, file));
        const gzipped = gzipSync(code, { level: 9 }).byteLength;
        expect(gzipped, `${file}: ${String(gzipped)} bytes gzipped`).toBeLessThanOrEqual(
          BUDGET_BYTES,
        );
        expect(code.toString('utf8')).not.toMatch(/from ['"]|require\(/);
      }
      expect(readFileSync(join(outDir, 'openverify.iife.js'), 'utf8')).toMatch(/OpenVerify/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
