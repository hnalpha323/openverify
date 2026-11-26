import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Workflow 7B Stage 1a (b): what the list keys and the CSV writer need. `csv-stringify` 6.9.0
 * (MIT) is the C100.6 writer's base; `@openverify/signals/address` gives a list key and a session
 * address one canonical form, and that narrow entry keeps `mmdb-lib` out of `@openverify/checks`.
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const manifest = (file: string) =>
  JSON.parse(read(file)) as {
    dependencies?: Record<string, string>;
    exports?: Record<string, Record<string, string>>;
  };

describe('the Workflow 7B dependencies', () => {
  it('pins csv-parse 7.0.3, csv-stringify 6.9.0 and ajv 8.20.0 in the catalog', () => {
    const catalog = read('pnpm-workspace.yaml');
    expect(catalog).toMatch(/^ {2}csv-parse: 7\.0\.3$/m);
    expect(catalog).toMatch(/^ {2}csv-stringify: 6\.9\.0$/m);
    expect(catalog).toMatch(/^ {2}ajv: 8\.20\.0$/m);
  });

  it('gives each one to its package, from the catalog', () => {
    expect(manifest('packages/checks/package.json').dependencies?.['csv-stringify']).toBe(
      'catalog:',
    );
    // Since Workflow 8A the one configuration of csv-parse is `readCsv` (F13).
    expect(manifest('packages/checks/package.json').dependencies?.['csv-parse']).toBe('catalog:');
    const api = manifest('apps/api/package.json').dependencies;
    expect(api?.['csv-parse']).toBeUndefined();
    expect(api?.ajv).toBe('catalog:');
  });

  it('links @openverify/signals through its narrow ./address entry only', () => {
    expect(manifest('packages/checks/package.json').dependencies?.['@openverify/signals']).toBe(
      'workspace:*',
    );
    expect(manifest('packages/signals/package.json').exports?.['./address']).toEqual({
      '@openverify/source': './src/network/address.ts',
      types: './dist/network/address.d.ts',
      default: './dist/network/address.js',
    });
  });
});
