import { describe, expect, it } from 'vitest';
import { staleFiles } from './fresh-render.js';
import { createMemoryRepository } from './repository.js';

describe('the generated-document rule', () => {
  const repo = createMemoryRepository({ 'docs/same.md': 'same\n', 'docs/old.md': 'old\n' });

  it('passes a committed file equal to its render, byte for byte', () => {
    expect(staleFiles(repo, [{ path: 'docs/same.md', content: 'same\n' }])).toEqual([]);
  });

  it('names a missing file and a differing one, in the render order', () => {
    expect(
      staleFiles(repo, [
        { path: 'docs/new.md', content: 'new\n' },
        { path: 'docs/same.md', content: 'same\n' },
        { path: 'docs/old.md', content: 'old' },
      ]),
    ).toEqual([
      { path: 'docs/new.md', reason: 'missing' },
      { path: 'docs/old.md', reason: 'differs' },
    ]);
  });
});
