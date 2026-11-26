/**
 * Read-only access to the repository (contracts-11e). Generators and checks take a
 * {@link Repository}, so a test can hand them a fixture tree ({@link createMemoryRepository}) and
 * the real tree ({@link createRepository}) alike. Paths are repository-relative with `/`; a path
 * that is absolute or climbs out with `..` is refused.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Repository } from './types.js';

/** The repository root, from this file's place (`packages/docs-tools/src/`). */
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Directory names never listed: installs, builds, caches and run outputs. */
export const SKIPPED_DIRECTORIES: readonly string[] = Object.freeze([
  '.git',
  '.gradle',
  '.kotlin',
  '.mypy_cache',
  '.next',
  '.pytest_cache',
  '.ruff_cache',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const SKIPPED = new Set(SKIPPED_DIRECTORIES);

/** `relative` normalised to `a/b/c` (no leading `./`, no trailing `/`); throws if it escapes. */
function normalise(relative: string): string {
  const posix = relative.replaceAll('\\', '/');
  const normalised = path.posix.normalize(posix === '' ? '.' : posix);
  if (path.posix.isAbsolute(posix) || normalised === '..' || normalised.startsWith('../')) {
    throw new Error(`not a repository-relative path: ${relative}`);
  }
  return normalised === '.' ? '' : normalised.replace(/\/$/, '');
}

function skipped(relative: string): boolean {
  return relative.split('/').some((part) => SKIPPED.has(part));
}

/** The real tree under `root`. */
export function createRepository(root: string): Repository {
  const absolute = (relative: string): string => path.join(root, normalise(relative));
  return {
    root,
    exists: (relative) => {
      const file = absolute(relative);
      return existsSync(file) && statSync(file).isFile();
    },
    readText: (relative) => {
      const file = absolute(relative);
      if (!existsSync(file) || !statSync(file).isFile()) {
        throw new Error(`no such file in the repository: ${normalise(relative)}`);
      }
      return readFileSync(file, 'utf8');
    },
    listFiles: (dir) => {
      const start = normalise(dir);
      const base = path.join(root, start);
      if (!existsSync(base) || !statSync(base).isDirectory()) {
        return [];
      }
      const found: string[] = [];
      const walk = (relative: string): void => {
        for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
          const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
          if (entry.isDirectory()) {
            if (!SKIPPED.has(entry.name)) {
              walk(child);
            }
          } else if (entry.isFile()) {
            found.push(child);
          }
        }
      };
      walk(start);
      return found.sort();
    },
  };
}

/** A fixture tree: repository-relative paths and their texts. */
export function createMemoryRepository(files: Readonly<Record<string, string>>): Repository {
  const texts = new Map(Object.entries(files).map(([file, text]) => [normalise(file), text]));
  return {
    root: 'memory:',
    exists: (relative) => texts.has(normalise(relative)),
    readText: (relative) => {
      const text = texts.get(normalise(relative));
      if (text === undefined) {
        throw new Error(`no such file in the repository: ${normalise(relative)}`);
      }
      return text;
    },
    listFiles: (dir) => {
      const start = normalise(dir);
      const prefix = start === '' ? '' : `${start}/`;
      return [...texts.keys()]
        .filter((file) => file.startsWith(prefix) && !skipped(file.slice(prefix.length)))
        .sort();
    },
  };
}
