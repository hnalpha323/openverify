/** docs-release's entry points (replaces contracts-11e's stub test). */
import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../repository.js';
import { checkRelease, releaseCheck, renderRelease } from './index.js';
import { fixtureFiles } from './release-check.fixtures.js';

describe('the release area', () => {
  const repo = createMemoryRepository(fixtureFiles());

  it('checks its own records: the checklist, the placements and the 11D lines', () => {
    expect(checkRelease(repo)).toEqual([
      { name: 'release-checklist', status: 'built', findings: [] },
      { name: 'release-deferrals', status: 'built', findings: [] },
      { name: 'release-calibration', status: 'built', findings: [] },
      {
        name: 'release-notes',
        status: 'built',
        findings: [
          {
            rule: 'notes-fresh',
            path: 'docs/release/notes.md',
            message:
              'the release notes do not exist: run pnpm --filter @openverify/docs-tools docs:release',
            severity: 'error',
          },
        ],
      },
    ]);
  });

  it('answers release:check in the mode it was asked for, built', () => {
    expect(releaseCheck(repo, { tag: false })).toMatchObject({ mode: 'default', status: 'built' });
    expect(releaseCheck(repo, { tag: true })).toMatchObject({ mode: 'tag', status: 'built' });
  });

  it('renders the release notes, and nothing else', () => {
    const rendered = renderRelease(repo);
    expect(rendered.status).toBe('built');
    expect(rendered.files.map((file) => file.path)).toEqual(['docs/release/notes.md']);
    expect(renderRelease(createMemoryRepository({}))).toEqual({
      area: 'release',
      status: 'built',
      files: [],
    });
  });
});
