/**
 * C273.4: the threat model's parsing test, over fixtures and over the committed document.
 */
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import {
  STRIDE_LETTERS,
  THREAT_MODEL_PATH,
  evidencePathExists,
  parseThreatModel,
  pathsCitedIn,
  threatModelFindings,
} from './threat-model.js';

const HEADER = '| id | boundary | STRIDE | threat | status | evidence | mitigation or owner |';
const RULE = '|---|---|---|---|---|---|---|';

/** A two-boundary model that passes every rule. */
const MODEL = [
  '# Threat model',
  '',
  '## Boundaries',
  '',
  '| boundary | what crosses it |',
  '|---|---|',
  '| B1 | the hosted flow |',
  '| BX | every boundary |',
  '',
  '## B1',
  '',
  HEADER,
  RULE,
  '| B1-S1 | B1 | S | a forwarded link | accepted | `apps/flow/a.ts` | the handoff note |',
  '| B1-T1 | B1 | T, I | a tampered capture | control | `apps/flow/a.ts:12`, `apps/flow/a.test.ts` | server-side analysis |',
  '| B1-R1 | B1 | R | a denied consent | gap | — | 11F (KP11-10) |',
  '| B1-D1 | B1 | D | a flood | operator | `docs/guide/` | the operator sizes the ingress |',
  '| B1-E1 | B1 | E | a raised role | gap | — | the next release |',
  '',
  '- BX S: not applicable because no row of its own spoofs anything.',
  '- BX T: not applicable because tampering is per boundary.',
  '- BX R: not applicable because repudiation is per boundary.',
  '- BX I: not applicable because disclosure is per boundary.',
  '- BX E: not applicable because privilege is per boundary.',
  '',
  '## BX',
  '',
  HEADER,
  RULE,
  '| BX-D1 | BX | D | a catastrophic pattern | control | `packages/p/x.test.ts` | the linear matcher |',
  '',
  '## Accepted risks',
  '',
  '| risk | rows | monitoring |',
  '|---|---|---|',
  '| A forwarded link | B1-S1 | operator check: the handoff audit entries |',
  '',
].join('\n');

const FILES = {
  'apps/flow/a.ts': 'export {};\n',
  'apps/flow/a.test.ts': 'export {};\n',
  'docs/guide/page.md': '# Page\n',
  'packages/p/x.test.ts': 'export {};\n',
};

const repo = createMemoryRepository(FILES);

describe('parsing the threat model (C273.1)', () => {
  const model = parseThreatModel(MODEL);

  it('reads the boundaries table', () => {
    expect(model.boundaries).toEqual(['B1', 'BX']);
  });

  it('reads every row of every table with its line, letters split', () => {
    expect(model.rows.map((row) => row.id)).toEqual([
      'B1-S1',
      'B1-T1',
      'B1-R1',
      'B1-D1',
      'B1-E1',
      'BX-D1',
    ]);
    expect(model.rows[1]).toEqual({
      line: 15,
      id: 'B1-T1',
      boundary: 'B1',
      stride: ['T', 'I'],
      threat: 'a tampered capture',
      status: 'control',
      evidence: '`apps/flow/a.ts:12`, `apps/flow/a.test.ts`',
      mitigation: 'server-side analysis',
    });
  });

  it('reads the "not applicable because" lines', () => {
    expect(model.notApplicable.map((item) => `${item.boundary} ${item.letter}`)).toEqual([
      'BX S',
      'BX T',
      'BX R',
      'BX I',
      'BX E',
    ]);
    expect(model.notApplicable[0]).toEqual({
      line: 20,
      boundary: 'BX',
      letter: 'S',
      reason: 'no row of its own spoofs anything.',
    });
  });

  it('reads the accepted-risks table', () => {
    expect(model.acceptedRisks).toEqual([
      {
        line: 36,
        risk: 'A forwarded link',
        rows: ['B1-S1'],
        monitoring: 'operator check: the handoff audit entries',
      },
    ]);
  });

  it('passes every rule', () => {
    expect(threatModelFindings(repo, model, 'model.md')).toEqual([]);
  });
});

describe('the cells a rule reads', () => {
  it('takes backticked repository paths, never routes, scopes or names', () => {
    expect(
      pathsCitedIn(
        '`apps/api/src/x.ts:10-20`, `docs/flow/` and `e2e/tests/a.spec.ts`; not `/api/v1/flow/signals`, `pii:view`, `OPENVERIFY_KEK`, `connect/share-token.created` or `x y/z`',
      ),
    ).toEqual(['apps/api/src/x.ts', 'docs/flow/', 'e2e/tests/a.spec.ts']);
  });

  it('finds files, and directories that hold files', () => {
    expect(evidencePathExists(repo, 'apps/flow/a.ts')).toBe(true);
    expect(evidencePathExists(repo, 'docs/guide/')).toBe(true);
    expect(evidencePathExists(repo, 'docs/guide')).toBe(true);
    expect(evidencePathExists(repo, 'apps/flow/missing.ts')).toBe(false);
    expect(evidencePathExists(repo, 'docs/none/')).toBe(false);
  });
});

/** The model with one exact piece of text replaced. */
function withText(from: string, to: string): string {
  expect(MODEL).toContain(from);
  return MODEL.replace(from, to);
}

function rulesOf(text: string): readonly string[] {
  return threatModelFindings(repo, parseThreatModel(text), 'model.md').map(
    (finding) => finding.rule,
  );
}

describe('the rules of C273.4', () => {
  it('needs all six letters per boundary, as a row or a "not applicable because" line', () => {
    const text = withText('- BX T: not applicable because tampering is per boundary.\n', '');
    const findings = threatModelFindings(repo, parseThreatModel(text), 'model.md');
    expect(findings.map((finding) => finding.rule)).toEqual(['stride-coverage']);
    expect(findings[0]?.message).toContain('BX');
  });

  it('refuses a "not applicable" line for a letter a row already covers', () => {
    const text = `${MODEL}\n- B1 S: not applicable because it is covered.\n`;
    expect(rulesOf(text)).toEqual(['not-applicable-covered']);
  });

  it('refuses an unknown status, letter or boundary', () => {
    expect(
      rulesOf(withText('| accepted | `apps/flow/a.ts` |', '| fixed | `apps/flow/a.ts` |')),
    ).toEqual(['status', 'accepted-risks']);
    expect(rulesOf(withText('| B1 | T, I |', '| B1 | T, X |'))).toEqual([
      'stride',
      'stride-coverage',
    ]);
    expect(rulesOf(withText('| B1-E1 | B1 |', '| B9-E1 | B9 |'))).toEqual([
      'boundary',
      'stride-coverage',
    ]);
  });

  it('needs an id that starts with its boundary, once only', () => {
    expect(rulesOf(withText('| B1-E1 | B1 |', '| BX-E1 | B1 |'))).toEqual(['id']);
    expect(rulesOf(withText('| B1-E1 | B1 |', '| B1-D1 | B1 |'))).toEqual(['unique-id']);
  });

  it('needs a control to cite a path, and every cited path to exist', () => {
    expect(
      rulesOf(
        withText(
          '| control | `apps/flow/a.ts:12`, `apps/flow/a.test.ts` |',
          '| control | server-side |',
        ),
      ),
    ).toEqual(['control-evidence']);
    expect(rulesOf(withText('`docs/guide/`', '`docs/missing/`'))).toEqual(['evidence-path']);
  });

  it('needs a gap to name a phase, the next release or a finding id', () => {
    expect(rulesOf(withText('| 11F (KP11-10) |', '| later |'))).toEqual(['gap-owner']);
    for (const owner of [
      'Phase 12',
      'Workflow 11F',
      '11G',
      'KP10-31',
      'K7C-R010',
      'R010',
      'E002',
      'Q10',
    ]) {
      expect(rulesOf(withText('| 11F (KP11-10) |', `| ${owner} |`)), owner).toEqual([]);
    }
  });

  it('needs every accepted row in the accepted-risks table, each with its monitoring', () => {
    expect(
      rulesOf(withText('| A forwarded link | B1-S1 |', '| A forwarded link | B1-D1 |')),
    ).toEqual(['accepted-risks', 'accepted-risks']);
    expect(
      rulesOf(
        withText('| operator check: the handoff audit entries |', '| we look at it sometimes |'),
      ),
    ).toEqual(['accepted-monitoring']);
    expect(
      rulesOf(
        withText('| operator check: the handoff audit entries |', '| metric: queue_at_cap_ms |'),
      ),
    ).toEqual([]);
    expect(
      rulesOf(withText('| A forwarded link | B1-S1 |', '| A forwarded link | B7-T1 |')),
    ).toEqual(['accepted-risks', 'accepted-risks']);
  });

  it('needs a boundaries table and at least one row', () => {
    expect(rulesOf('# Threat model\n')).toEqual(['boundaries', 'rows']);
  });
});

/** Hardening 3.2's first pass: every one of its 46 ids is re-taken (C273.2). */
const HARDENING_IDS = [
  ['B1-S1', 'B1-T1', 'B1-I1', 'B1-I2', 'B1-D1', 'B1-R1'],
  ['B2-S1', 'B2-T1', 'B2-I1'],
  ['B3-S1', 'B3-T1', 'B3-R1', 'B3-I1', 'B3-D1', 'B3-E1'],
  ['B4-S1', 'B4-T1', 'B4-I1', 'B4-R1', 'B4-E1'],
  ['B5-S1', 'B5-I1', 'B5-D1', 'B5-E1'],
  ['B6-T1', 'B6-S1', 'B6-D1'],
  ['B7-I1', 'B7-T1', 'B7-E1', 'B7-R1'],
  ['B8-S1', 'B8-D1'],
  ['B9-I1', 'B9-T1'],
  ['B10-I1', 'B10-T1', 'B10-I2'],
  ['B11-T1', 'B11-I1', 'B11-S1'],
  ['B12-E1'],
  ['B13-I1'],
  ['B14-T1', 'B14-I1'],
  ['BX-D1'],
].flat();

describe('the committed threat model', () => {
  const real = createRepository(REPOSITORY_ROOT);
  const model = parseThreatModel(real.readText(THREAT_MODEL_PATH));

  it('passes every rule of C273.4', () => {
    expect(threatModelFindings(real, model)).toEqual([]);
  });

  it('models B1 to B14 and BX', () => {
    expect(model.boundaries).toEqual([
      ...Array.from({ length: 14 }, (_, index) => `B${String(index + 1)}`),
      'BX',
    ]);
  });

  it("re-takes every one of hardening 3.2's 46 rows", () => {
    expect(HARDENING_IDS).toHaveLength(46);
    const ids = new Set(model.rows.map((row) => row.id));
    expect(HARDENING_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('designs Connect (B13) fully: at least eighteen rows over all six letters', () => {
    const connect = model.rows.filter((row) => row.boundary === 'B13');
    expect(connect.length).toBeGreaterThanOrEqual(18);
    for (const letter of STRIDE_LETTERS) {
      expect(
        connect.some((row) => row.stride.includes(letter)),
        letter,
      ).toBe(true);
    }
  });
});
