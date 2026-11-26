import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPOSITORY_ROOT,
  SKIPPED_DIRECTORIES,
  createMemoryRepository,
  createRepository,
} from './repository.js';

describe('the repository root', () => {
  it('is the directory that holds the workspace file, two levels above this package', () => {
    expect(existsSync(path.join(REPOSITORY_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(path.relative(REPOSITORY_ROOT, import.meta.dirname)).toBe(
      path.join('packages', 'docs-tools', 'src'),
    );
  });
});

describe('a fixture repository', () => {
  const repo = createMemoryRepository({
    'docs/b.md': 'b',
    'docs/a.md': 'a',
    'docs/deep/c.md': 'c',
    'docs/node_modules/x.md': 'skipped',
    'other/d.md': 'd',
  });

  it('reads a file by its repository-relative path', () => {
    expect(repo.root).toBe('memory:');
    expect(repo.exists('docs/a.md')).toBe(true);
    expect(repo.readText('docs/deep/c.md')).toBe('c');
  });

  it('answers false for a directory or a missing file, and throws reading one', () => {
    expect(repo.exists('docs')).toBe(false);
    expect(repo.exists('docs/missing.md')).toBe(false);
    expect(() => repo.readText('docs/missing.md')).toThrow('docs/missing.md');
  });

  it('lists a directory recursively, sorted, without skipped directories', () => {
    expect(repo.listFiles('docs')).toEqual(['docs/a.md', 'docs/b.md', 'docs/deep/c.md']);
    expect(repo.listFiles('docs/')).toEqual(['docs/a.md', 'docs/b.md', 'docs/deep/c.md']);
    expect(repo.listFiles('absent')).toEqual([]);
    expect(repo.listFiles('')).toEqual(['docs/a.md', 'docs/b.md', 'docs/deep/c.md', 'other/d.md']);
  });

  it('refuses a path that leaves the repository or is absolute', () => {
    expect(() => repo.readText('../outside.md')).toThrow('repository-relative');
    expect(() => repo.exists('/etc/hosts')).toThrow('repository-relative');
    expect(() => repo.listFiles('docs/../..')).toThrow('repository-relative');
  });
});

describe('the real repository', () => {
  const repo = createRepository(REPOSITORY_ROOT);

  it('reads this package from the root', () => {
    expect(repo.root).toBe(REPOSITORY_ROOT);
    expect(repo.exists('packages/docs-tools/package.json')).toBe(true);
    expect(repo.exists('packages/docs-tools/src')).toBe(false);
    expect(JSON.parse(repo.readText('packages/docs-tools/package.json'))).toMatchObject({
      name: '@openverify/docs-tools',
      private: true,
    });
    expect(() => repo.readText('packages/docs-tools/absent.md')).toThrow('absent.md');
  });

  it('lists files sorted and repository-relative, never inside an install or a build', () => {
    const files = repo.listFiles('packages/docs-tools');

    expect(files).toContain('packages/docs-tools/src/repository.ts');
    expect(files).toEqual([...files].sort());
    expect(files.some((file) => file.includes('/node_modules/'))).toBe(false);
    expect(files.some((file) => file.includes('/coverage/'))).toBe(false);
    expect(repo.listFiles('packages/docs-tools/absent')).toEqual([]);
    expect(SKIPPED_DIRECTORIES).toEqual(
      expect.arrayContaining(['node_modules', 'dist', 'build', 'coverage', '.git']),
    );
  });
});
