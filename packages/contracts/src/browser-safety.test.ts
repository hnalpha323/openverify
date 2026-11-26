import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Test-only helpers may use Node APIs; they are excluded from the build. */
const TEST_ONLY = /\.test\.ts$|^test-support\.ts$/;

const sources = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts') && !TEST_ONLY.test(path.basename(file)))
  .map((file) => ({
    file,
    text: readFileSync(path.join(import.meta.dirname, file), 'utf8'),
  }));

describe('@openverify/contracts is browser-safe', () => {
  it('has runtime sources to check', () => {
    expect(sources.map(({ file }) => file)).toContain('index.ts');
  });

  it.each(sources)('$file uses no Node-only APIs', ({ text }) => {
    expect(text).not.toMatch(/from\s+['"]node:/);
    expect(text).not.toMatch(/import\(\s*['"]node:/);
    expect(text).not.toMatch(/\brequire\(/);
    expect(text).not.toMatch(/\bBuffer\b/);
    expect(text).not.toMatch(/\bprocess\./);
  });

  it.each(sources)('$file imports only zod, workspace packages and local modules', ({ text }) => {
    const specifiers = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^(?:zod|@openverify\/(?:core|flow-spec)|\.\/[a-z0-9-]+\.js)$/);
    }
  });
});
