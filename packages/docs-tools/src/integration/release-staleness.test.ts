/**
 * C274.6 folded into `pnpm release:check` (Workflow 11E, integration-11e; docs-security's contract
 * deviation): a stale checklist row is an `owner` finding, which the default mode reports and
 * `--tag` refuses. The history is a fake (rule 6: never the working tree's HEAD).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../repository.js';
import { RELEASE_CHECK_DEPS, runReleaseCheck } from '../release/index.js';
import {
  ASVS_CSV_PATH,
  ASVS_IDS_PATH,
  SECURITY_CHECKLIST_COLUMNS,
  type EvidenceHistory,
} from '../security/index.js';
import { staleAwareReleaseCheck } from './release-staleness.js';

const REPO = createMemoryRepository({
  [ASVS_IDS_PATH]: ['# ids', '# ids', '# ids', '# ids', 'v5.0.0-1.1.1 2', ''].join('\n'),
  [ASVS_CSV_PATH]: [
    SECURITY_CHECKLIST_COLUMNS.join(','),
    'v5.0.0-1.1.1,2,met,src/a.test.ts; src/a.ts,Ours.,,2026-11-20,aaaaaaa',
    '',
  ].join('\n'),
  'src/a.test.ts': 'test\n',
  'src/a.ts': 'code\n',
});

/** A fake history in which `changed` changed after every commit. */
const history = (changed: readonly string[]): EvidenceHistory => ({
  changedSince: (_commit, paths) => paths.filter((path) => changed.includes(path)),
});

const stale = (findings: readonly { rule: string; severity: string }[]) =>
  findings.filter((finding) => finding.rule === 'security/stale-evidence');

describe('staleAwareReleaseCheck', () => {
  it('reports a row whose cited file changed after its review as an owner item', () => {
    const result = staleAwareReleaseCheck(history(['src/a.ts']))(REPO, { tag: false });
    expect(result.mode).toBe('default');
    expect(stale(result.findings)).toEqual([
      expect.objectContaining({ rule: 'security/stale-evidence', severity: 'owner' }),
    ]);
  });

  it('reports nothing stale when no cited file changed', () => {
    const result = staleAwareReleaseCheck(history([]))(REPO, { tag: true });
    expect(result.mode).toBe('tag');
    expect(stale(result.findings)).toEqual([]);
  });

  it('adds only the staleness to the release check it wraps', () => {
    const plain = runReleaseCheck(REPO, { tag: false }, RELEASE_CHECK_DEPS).findings;
    const aware = staleAwareReleaseCheck(history(['src/a.ts']))(REPO, { tag: false }).findings;
    expect(stale(plain)).toEqual([]);
    expect(aware.filter((finding) => finding.rule !== 'security/stale-evidence')).toEqual(plain);
  });
});
