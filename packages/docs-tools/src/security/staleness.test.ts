/**
 * C274.6: a row is stale when a file its evidence cites changed after its `reviewed_commit`. The
 * history is injected (a fake, and a fixture git repository built in a temporary directory), never
 * the working tree's moving HEAD (rule 6).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSecurityChecklist, SECURITY_CHECKLIST_COLUMNS } from './checklist.js';
import {
  createGitEvidenceHistory,
  staleChecklistRows,
  stalenessCheck,
  type EvidenceHistory,
} from './staleness.js';

const HEADER = SECURITY_CHECKLIST_COLUMNS.join(',');
const ROWS = parseSecurityChecklist(
  [
    HEADER,
    'v5.0.0-1.1.1,2,met,src/a.test.ts; src/a.ts,Ours.,,2026-11-20,aaaaaaa',
    'v5.0.0-1.2.1,1,met,docs/guide/,Ours.,,2026-11-20,aaaaaaa',
    'v5.0.0-1.2.2,1,met,src/b.test.ts,Ours.,,2026-11-20,bbbbbbb',
    'v5.0.0-4.3.1,2,not_applicable,,Not applicable because none.,,2026-11-20,aaaaaaa',
    '',
  ].join('\n'),
);

/** A fake history: the files that changed since each commit. */
function fakeHistory(changed: Record<string, readonly string[]>): EvidenceHistory & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    changedSince: (commit, paths) => {
      calls.push(commit);
      const files = changed[commit] ?? [];
      return files.filter((file) =>
        paths.some((cited) => (cited.endsWith('/') ? file.startsWith(cited) : file === cited)),
      );
    },
  };
}

describe('staleChecklistRows', () => {
  it('names each row whose cited files changed after its review, with those files', () => {
    const history = fakeHistory({
      aaaaaaa: ['src/a.ts', 'docs/guide/page.md', 'src/unrelated.ts'],
      bbbbbbb: [],
    });
    expect(staleChecklistRows(ROWS, history)).toEqual([
      { id: 'v5.0.0-1.1.1', reviewedCommit: 'aaaaaaa', changed: ['src/a.ts'] },
      { id: 'v5.0.0-1.2.1', reviewedCommit: 'aaaaaaa', changed: ['docs/guide/page.md'] },
    ]);
  });

  it('asks the history once per reviewed commit, and nothing for rows without evidence', () => {
    const history = fakeHistory({});
    expect(staleChecklistRows(ROWS, history)).toEqual([]);
    expect(history.calls).toEqual(['aaaaaaa', 'bbbbbbb']);
  });

  it('reports a stale row as an owner finding, never an error', () => {
    const history = fakeHistory({ bbbbbbb: ['src/b.test.ts'] });
    expect(stalenessCheck('asvs-staleness', 'list.csv', ROWS, history)).toEqual({
      name: 'asvs-staleness',
      status: 'built',
      findings: [
        {
          rule: 'stale-evidence',
          path: 'list.csv',
          line: 4,
          message:
            'v5.0.0-1.2.2: src/b.test.ts changed after reviewed_commit bbbbbbb; review the row again (C274.6)',
          severity: 'owner',
        },
      ],
    });
  });
});

describe('createGitEvidenceHistory over a fixture repository', () => {
  let root = '';
  let first = '';
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { encoding: 'utf8' },
    ).trim();

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'docs-security-history-'));
    git('init', '-q');
    mkdirSync(path.join(root, 'docs', 'guide'), { recursive: true });
    writeFileSync(path.join(root, 'a.ts'), 'one\n');
    writeFileSync(path.join(root, 'b.ts'), 'one\n');
    writeFileSync(path.join(root, 'docs', 'guide', 'page.md'), 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    first = git('rev-parse', 'HEAD');
    writeFileSync(path.join(root, 'a.ts'), 'two\n');
    writeFileSync(path.join(root, 'docs', 'guide', 'page.md'), 'two\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'second');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('answers the cited files changed since the commit, a directory by its files', () => {
    const history = createGitEvidenceHistory(root);
    expect(history.changedSince(first, ['a.ts', 'b.ts', 'docs/guide/'])).toEqual([
      'a.ts',
      'docs/guide/page.md',
    ]);
    expect(history.changedSince(first.slice(0, 9), ['b.ts'])).toEqual([]);
  });

  it('treats a commit the repository does not hold as every cited file changed', () => {
    const history = createGitEvidenceHistory(root);
    expect(history.changedSince('0123456789abcdef', ['a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
  });
});
