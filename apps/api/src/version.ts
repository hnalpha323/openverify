import { readFileSync } from 'node:fs';

/** Version from apps/api/package.json; resolves the same from `src/` and `dist/`. */
export function packageVersion(): string {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(manifest) as { version: string }).version;
}
