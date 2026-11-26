/**
 * C274.3 and C275.3: the ASVS and MASVS checklists' evidence test, over fixtures and over the
 * committed CSVs (11E decisions items 6 and 7).
 */
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import {
  ASVS_CSV_PATH,
  ASVS_IDS_PATH,
  MASVS_CSV_PATH,
  MASVS_IDS_PATH,
  SECURITY_CHECKLIST_COLUMNS,
  isTestEvidence,
  parseSecurityChecklist,
  parseStandardIdList,
  securityChecklistFindings,
  securityChecklistSkeleton,
  type SecurityChecklistContext,
} from './checklist.js';
import { THREAT_MODEL_PATH, parseThreatModel } from './threat-model.js';

const HEADER = SECURITY_CHECKLIST_COLUMNS.join(',');

const IDS = [
  '# A fixture list.',
  '# <id> <level>',
  'v5.0.0-1.1.1 2',
  'v5.0.0-1.2.1 1',
  'v5.0.0-1.2.2 1',
  'v5.0.0-4.3.1 2',
  'v5.0.0-6.2.2 1',
  'v5.0.0-12.1.1 1',
  '',
].join('\n');

const CSV = [
  HEADER,
  'v5.0.0-1.1.1,2,met,apps/api/src/a.test.ts; docs/x.md,Parsed once at the boundary.,B3-T1,2026-11-20,abc1234',
  'v5.0.0-1.2.1,1,partial,apps/api/src/a.ts,"Met in the console, not the API (11F).",B4-I1; B3-T1,2026-11-20,abc1234',
  'v5.0.0-1.2.2,1,met,e2e/tests/b.spec.ts,Encoded URLs.,,2026-11-20,abc1234',
  'v5.0.0-4.3.1,2,not_applicable,,Not applicable because there is no GraphQL.,,2026-11-20,abc1234',
  'v5.0.0-6.2.2,1,gap,,No password change route; next release.,B4-S1,2026-11-20,abc1234',
  "v5.0.0-12.1.1,1,operator,,TLS ends at the operator's ingress.,,2026-11-20,abc1234",
  '',
].join('\n');

const FILES = {
  'apps/api/src/a.test.ts': 'export {};\n',
  'apps/api/src/a.ts': 'export {};\n',
  'docs/x.md': '# X\n',
  'e2e/tests/b.spec.ts': 'export {};\n',
};
const repo = createMemoryRepository(FILES);

const context = (ids = parseStandardIdList(IDS)): SecurityChecklistContext => ({
  csvPath: 'list.csv',
  ids,
  threatIds: new Set(['B3-T1', 'B4-I1', 'B4-S1']),
});

const rulesOf = (csv: string, ctx = context()): readonly string[] =>
  securityChecklistFindings(repo, parseSecurityChecklist(csv), ctx).map((finding) => finding.rule);

/** The fixture CSV with one exact piece of text replaced. */
function withText(from: string, to: string): string {
  expect(CSV).toContain(from);
  return CSV.replace(from, to);
}

describe('the committed id lists', () => {
  it('skip comment lines and read <id> <level> pairs', () => {
    expect(parseStandardIdList(IDS)).toEqual([
      { id: 'v5.0.0-1.1.1', level: '2' },
      { id: 'v5.0.0-1.2.1', level: '1' },
      { id: 'v5.0.0-1.2.2', level: '1' },
      { id: 'v5.0.0-4.3.1', level: '2' },
      { id: 'v5.0.0-6.2.2', level: '1' },
      { id: 'v5.0.0-12.1.1', level: '1' },
    ]);
  });
});

describe('parsing a checklist (C274.1)', () => {
  it('reads every row with its evidence and threats split', () => {
    const rows = parseSecurityChecklist(CSV);
    expect(rows).toHaveLength(6);
    expect(rows[1]).toEqual({
      line: 3,
      id: 'v5.0.0-1.2.1',
      level: '1',
      status: 'partial',
      evidence: ['apps/api/src/a.ts'],
      notes: 'Met in the console, not the API (11F).',
      threats: ['B4-I1', 'B3-T1'],
      reviewedAt: '2026-11-20',
      reviewedCommit: 'abc1234',
    });
    expect(rows[3]?.evidence).toEqual([]);
  });

  it('refuses a header other than C274.1 columns', () => {
    expect(() => parseSecurityChecklist('id,level,status\nv5.0.0-1.1.1,2,met\n')).toThrow(
      /columns/,
    );
  });

  it('passes every rule over the fixture', () => {
    expect(rulesOf(CSV)).toEqual([]);
  });
});

describe('what counts as a test or a check that ran locally', () => {
  it('takes test files of every suite, never a document or a CI workflow alone', () => {
    for (const path of [
      'apps/api/src/a.test.ts',
      'apps/api/src/a.integration.test.ts',
      'apps/dashboard/src/b.test.tsx',
      'e2e/tests/c.spec.ts',
      'apps/flow/e2e/d.spec.ts',
      'services/vision/tests/test_guarded.py',
      'android/scripts/tests/test_check_size.py',
      'android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/AbiDumpTest.kt',
      'infra/tests/images.test.sh',
      'deploy/helm/openverify/ci/tests/kind.test.sh',
      'deploy/helm/openverify/tests/c264-ingress_test.yaml',
    ]) {
      expect(isTestEvidence(path), path).toBe(true);
    }
    for (const path of [
      'docs/security/threat-model.md',
      '.github/workflows/ci.yml',
      'apps/api/src/a.ts',
      'android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/privacy/SourceScan.kt',
    ]) {
      expect(isTestEvidence(path), path).toBe(false);
    }
  });
});

describe('the rules of C274.3', () => {
  it('needs exactly the committed ids, in their order and with their levels', () => {
    const lines = CSV.split('\n');
    const dropped = lines.filter((line) => !line.startsWith('v5.0.0-4.3.1,')).join('\n');
    expect(rulesOf(dropped)).toEqual(['missing-id']);
    expect(rulesOf(`${CSV}v5.0.0-99.1.1,2,gap,,Next release.,,2026-11-20,abc1234\n`)).toEqual([
      'extra-id',
    ]);
    const swapped = [lines[0], lines[2], lines[1], ...lines.slice(3)].join('\n');
    expect(rulesOf(swapped)).toEqual(['order']);
    expect(rulesOf(`${CSV}${lines[1] ?? ''}\n`)).toEqual(['duplicate-id']);
    expect(rulesOf(withText('v5.0.0-1.1.1,2,', 'v5.0.0-1.1.1,1,'))).toEqual(['level']);
  });

  it('refuses an unknown status', () => {
    expect(rulesOf(withText('1.2.2,1,met,', '1.2.2,1,done,'))).toEqual(['status']);
  });

  it('needs every evidence path to exist', () => {
    expect(rulesOf(withText('docs/x.md', 'docs/missing.md'))).toEqual(['evidence-path']);
  });

  it('needs a met row to cite a test or a check that ran locally, never a CI job alone', () => {
    expect(rulesOf(withText('1.2.2,1,met,e2e/tests/b.spec.ts', '1.2.2,1,met,docs/x.md'))).toEqual([
      'met-evidence',
    ]);
  });

  it('needs a reason on not_applicable, partial and operator rows', () => {
    expect(rulesOf(withText('Not applicable because there is no GraphQL.', ''))).toEqual([
      'reason',
    ]);
    expect(rulesOf(withText('"Met in the console, not the API (11F)."', ''))).toEqual(['reason']);
    expect(rulesOf(withText("TLS ends at the operator's ingress.", ''))).toEqual(['reason']);
  });

  it('needs a gap row to name a phase, the next release or a finding id', () => {
    expect(rulesOf(withText('No password change route; next release.', 'Not built.'))).toEqual([
      'gap-owner',
    ]);
  });

  it('needs every threats id to exist in the threat model', () => {
    expect(rulesOf(withText(',B4-S1,', ',B4-S9,'))).toEqual(['threat-id']);
  });

  it('needs a review date and a commit', () => {
    expect(rulesOf(withText('Encoded URLs.,,2026-11-20,', 'Encoded URLs.,,20-11-2026,'))).toEqual([
      'reviewed-at',
    ]);
    expect(
      rulesOf(withText('Encoded URLs.,,2026-11-20,abc1234', 'Encoded URLs.,,2026-11-20,HEAD')),
    ).toEqual(['reviewed-commit']);
  });

  it('refuses a metric name the registry does not hold', () => {
    expect(rulesOf(withText('Encoded URLs.', 'Watch metric: queue_nothing_here.'))).toEqual([
      'metric-name',
    ]);
    expect(rulesOf(withText('Encoded URLs.', 'Watch metric: queue_at_cap_ms.'))).toEqual([]);
  });
});

describe('a checklist skeleton for a new version', () => {
  it('holds every id at gap with the header and passes the id rules', () => {
    const ids = parseStandardIdList(IDS);
    const skeleton = securityChecklistSkeleton(ids, '2026-11-20');
    const rows = parseSecurityChecklist(skeleton);
    expect(rows.map((row) => row.id)).toEqual(ids.map((id) => id.id));
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['gap']));
    expect(skeleton.split('\n')[0]).toBe(HEADER);
    expect(rulesOf(skeleton)).toEqual([]);
  });
});

describe('the committed checklists', () => {
  const real = createRepository(REPOSITORY_ROOT);
  const threatIds = new Set(
    parseThreatModel(real.readText(THREAT_MODEL_PATH)).rows.map((row) => row.id),
  );

  for (const [csvPath, idsPath, count] of [
    [ASVS_CSV_PATH, ASVS_IDS_PATH, 253],
    [MASVS_CSV_PATH, MASVS_IDS_PATH, 24],
  ] as const) {
    it(`${csvPath} holds exactly the ${String(count)} committed ids and passes every rule`, () => {
      const ids = parseStandardIdList(real.readText(idsPath));
      expect(ids).toHaveLength(count);
      const rows = parseSecurityChecklist(real.readText(csvPath));
      expect(rows.map((row) => row.id)).toEqual(ids.map((id) => id.id));
      expect(securityChecklistFindings(real, rows, { csvPath, ids, threatIds })).toEqual([]);
    });
  }

  it('keeps V17, V4.3 and V4.4 not applicable, and applies V9, V10 and V6.8 to the OIDC client', () => {
    const rows = parseSecurityChecklist(real.readText(ASVS_CSV_PATH));
    const statusOf = (prefix: string) =>
      new Set(rows.filter((row) => row.id.startsWith(prefix)).map((row) => row.status));
    expect(statusOf('v5.0.0-17.')).toEqual(new Set(['not_applicable']));
    expect(statusOf('v5.0.0-4.3.')).toEqual(new Set(['not_applicable']));
    expect(statusOf('v5.0.0-4.4.')).toEqual(new Set(['not_applicable']));
    expect(statusOf('v5.0.0-10.2.')).toEqual(new Set(['met']));
    expect(statusOf('v5.0.0-10.5.').has('met')).toBe(true);
    expect(statusOf('v5.0.0-9.1.')).toEqual(new Set(['met']));
    expect(statusOf('v5.0.0-6.8.').has('met')).toBe(true);
  });
});
