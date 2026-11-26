/**
 * The evaluators' own source (`packages/checks`, which the console does not depend on), read at
 * test time: the values a check records in its metadata are read from it, so a value added there
 * without words in the console fails the console's test (as `selfie-words.test.ts` reads the
 * selfie flags).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Not `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const CHECKS_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'checks',
  'src',
);

/** The text of `packages/checks/src/<file>`. */
export function checksSource(file: string): string {
  return readFileSync(join(CHECKS_SRC, file), 'utf8');
}

const literalsIn = (text: string) =>
  [...text.matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);

/** The string literals of the array assigned to `name` (`const NAME = [...]`, frozen or not). */
export function arrayOf(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`No array ${name} in the source`);
  }
  return literalsIn(match[1]);
}

/** The string literals of the union type `name` (`type Name = 'a' | 'b';`, over lines or not). */
export function unionOf(source: string, name: string): string[] {
  const match = new RegExp(`type ${name} =([^;]*);`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`No type ${name} in the source`);
  }
  return literalsIn(match[1]);
}

/** Every distinct string literal written as the value of `key` (`key: 'value'`), in order. */
export function valuesOf(source: string, key: string): string[] {
  const values = [...source.matchAll(new RegExp(`\\b${key}: '([^']+)'`, 'g'))].flatMap(
    (match) => match[1] ?? [],
  );
  return [...new Set(values)];
}
