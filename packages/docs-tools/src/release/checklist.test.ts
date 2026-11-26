import { describe, expect, it } from 'vitest';
import { createMemoryRepository, createRepository, REPOSITORY_ROOT } from '../repository.js';
import {
  CHECKLIST_PATH,
  checkChecklist,
  checklistFindings,
  parseChecklist,
  PLAN_PATH,
  planChecklistLines,
  planLineId,
} from './checklist.js';
import { REQUIRED_KNOWN_ITEMS } from './known-items.js';

const PLAN = [
  '# Plan',
  '',
  '## Release checklist (what must be true before the owner tags the release)',
  '',
  'This release ships the web platform and Android. **No iOS code, app or artifact ships in it**.',
  '',
  '**Built and green (agents and CI):**',
  '- [ ] First built line.',
  '- [ ] Second built line with `code`.',
  '',
  '**Owner steps and decisions (not agents):**',
  '- [ ] The owner tags.',
  '',
  '## Acceptance',
  '',
  '- [ ] Not a checklist line.',
].join('\n');

const HEADER = '| Id | Line | State | Who | Evidence | Date |\n|---|---|---|---|---|---|';

function checklist(rows: string, facts = true): string {
  return [
    '# Release checklist',
    '',
    'No iOS code, app or artifact ships in this release.',
    '',
    ...(facts
      ? ['- As of: `2026-11-20`', '- Release version: `0.1.0`', '- Shipped flow image: `guidance`']
      : []),
    '',
    '## Built and green',
    '',
    HEADER,
    rows,
  ].join('\n');
}

const GOOD_ROWS = [
  '| B01 | First built line. | done | orchestrator | `docs/PROGRESS.md:12` | 2026-11-20 |',
  '| B02 | Second built line with `code`. | open | 11F | none yet | 2026-11-20 |',
  '| O01 | The owner tags. | owner | owner | `docs/PROGRESS.md` | 2026-11-20 |',
  '| KP10-31 | Open by design. | open | by design | `docs/PROGRESS.md` | 2026-11-20 |',
].join('\n');

function repo(
  rows: string,
  extra: Record<string, string> = {},
): ReturnType<typeof createMemoryRepository> {
  return createMemoryRepository({
    [PLAN_PATH]: PLAN,
    [CHECKLIST_PATH]: checklist(rows),
    'docs/PROGRESS.md': '# Progress\n',
    ...extra,
  });
}

describe('planChecklistLines', () => {
  it('reads both lists of the plan’s Release checklist, and nothing after it', () => {
    expect(planChecklistLines(PLAN)).toEqual([
      { list: 'built', text: 'First built line.' },
      { list: 'built', text: 'Second built line with `code`.' },
      { list: 'owner', text: 'The owner tags.' },
    ]);
  });

  it('gives each list its own id series', () => {
    expect(planLineId('built', 0)).toBe('B01');
    expect(planLineId('owner', 9)).toBe('O10');
  });

  it('reads the real plan: sixteen built lines and nine owner lines', () => {
    const real = createRepository(REPOSITORY_ROOT).readText(PLAN_PATH);
    const lines = planChecklistLines(real);
    expect(lines.filter((line) => line.list === 'built')).toHaveLength(16);
    expect(lines.filter((line) => line.list === 'owner')).toHaveLength(9);
  });
});

describe('parseChecklist', () => {
  it('reads the facts and every row with its state, evidence paths and date', () => {
    const parsed = parseChecklist(checklist(GOOD_ROWS));
    expect(parsed.problems).toEqual([]);
    expect(parsed.facts).toEqual({
      asOf: '2026-11-20',
      releaseVersion: '0.1.0',
      shippedFlowImage: 'guidance',
    });
    expect(parsed.lines.map((line) => [line.id, line.state, line.section])).toEqual([
      ['B01', 'done', 'Built and green'],
      ['B02', 'open', 'Built and green'],
      ['O01', 'owner', 'Built and green'],
      ['KP10-31', 'open', 'Built and green'],
    ]);
    expect(parsed.lines[0]?.evidencePaths).toEqual(['docs/PROGRESS.md']);
    expect(parsed.lines[1]?.evidencePaths).toEqual([]);
    expect(parsed.lines[0]?.line).toBe(13);
  });

  it('reports a bad state, a bad date, a duplicate id and a short row', () => {
    const parsed = parseChecklist(
      checklist(
        [
          '| B01 | x | finished | a | none | 2026-11-20 |',
          '| B02 | x | open | a | none | 20 November |',
          '| B02 | x | open | a | none | 2026-11-20 |',
          '| B03 | x | open |',
        ].join('\n'),
      ),
    );
    expect(parsed.problems.map((problem) => problem.message)).toEqual([
      'B01: state "finished" is not one of done, open, owner, ci-pending',
      'B02: date "20 November" is not YYYY-MM-DD',
      'B02: duplicate id',
      'row has 3 cells, not 6',
    ]);
  });

  it('reads only paths from the evidence: a word in backticks is not a path', () => {
    const parsed = parseChecklist(
      checklist(
        '| B01 | x | open | a | `pnpm release:check`; `docs/a.md#top`; `b.csv:3-9` | 2026-11-20 |',
      ),
    );
    expect(parsed.lines[0]?.evidencePaths).toEqual(['docs/a.md', 'b.csv']);
  });
});

describe('checklistFindings', () => {
  it('passes a checklist that holds every plan line and every required id', () => {
    expect(checklistFindings(repo(GOOD_ROWS), ['KP10-31'])).toEqual([]);
  });

  it('fails a missing checklist', () => {
    const findings = checklistFindings(createMemoryRepository({ [PLAN_PATH]: PLAN }), []);
    expect(findings.map((finding) => finding.rule)).toEqual(['checklist-missing']);
  });

  it('fails a plan line that is missing or worded differently', () => {
    const rows = GOOD_ROWS.replace(
      '| B02 | Second built line with `code`. |',
      '| B02 | Second line. |',
    );
    const findings = checklistFindings(repo(rows.replace(/\| O01 .*\n/, '')), ['KP10-31']);
    expect(findings.map((finding) => [finding.rule, finding.message])).toEqual([
      [
        'checklist-plan-line',
        'B02 does not hold the plan’s line: "Second built line with `code`."',
      ],
      ['checklist-plan-line', 'O01 is missing: "The owner tags."'],
    ]);
  });

  it('fails a required known item that has no line', () => {
    const findings = checklistFindings(repo(GOOD_ROWS), ['KP10-31', 'KP11-42']);
    expect(findings.map((finding) => finding.message)).toEqual([
      'KP11-42 has no line (KP11-50: every deferred known item by id)',
    ]);
  });

  it('fails a done line without evidence, and any evidence path that does not exist', () => {
    const rows = GOOD_ROWS.replace('`docs/PROGRESS.md:12`', 'none').replace(
      '| O01 | The owner tags. | owner | owner | `docs/PROGRESS.md` |',
      '| O01 | The owner tags. | owner | owner | `docs/missing.md` |',
    );
    const findings = checklistFindings(repo(rows), ['KP10-31']);
    expect(findings.map((finding) => [finding.rule, finding.message])).toEqual([
      ['checklist-evidence', 'B01 is done but cites no evidence path'],
      ['checklist-evidence', 'O01 cites docs/missing.md, which does not exist'],
    ]);
  });

  it('fails missing facts, a bad row and a missing no-iOS preamble', () => {
    const text = checklist(
      GOOD_ROWS + '\n| b 9 | x | open | a | none | 2026-11-20 |',
      false,
    ).replace('No iOS code, app or artifact ships in this release.', '');
    const findings = checklistFindings(
      createMemoryRepository({ [PLAN_PATH]: PLAN, [CHECKLIST_PATH]: text, 'docs/PROGRESS.md': '' }),
      ['KP10-31'],
    );
    expect(findings.map((finding) => finding.rule)).toEqual([
      'checklist-ios',
      'checklist-facts',
      'checklist-facts',
      'checklist-facts',
      'checklist-row',
    ]);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
  });
});

describe('the committed checklist (C284.1, KP11-50)', () => {
  const real = createRepository(REPOSITORY_ROOT);

  it('passes its record test: every plan line, every required id, evidence that exists', () => {
    expect(checkChecklist(real)).toEqual([]);
  });

  it('names every deferred known item of the 11E launch by id', () => {
    const ids = new Set(parseChecklist(real.readText(CHECKLIST_PATH)).lines.map((line) => line.id));
    expect(REQUIRED_KNOWN_ITEMS.length).toBeGreaterThanOrEqual(60);
    for (const item of REQUIRED_KNOWN_ITEMS) {
      expect(ids.has(item.id), item.id).toBe(true);
    }
  });

  it('marks no line done in 11E that waits on the owner, CI or a later Workflow', () => {
    const lines = parseChecklist(real.readText(CHECKLIST_PATH)).lines;
    // From Workflow 11F on, a known item's line is done once a fixer fixed it (decision 14 before
    // 11F); the owner steps and E002 never are, and no line 11E set may read done.
    const owners = lines.filter(
      (line) =>
        /^(?:O\d\d|E002)/.test(line.id) || (line.id.startsWith('KP') && line.date <= '2026-11-20'),
    );
    expect(owners.filter((line) => line.state === 'done')).toEqual([]);
    expect(lines.find((line) => line.id === 'KP10-59')?.state).toBe('ci-pending');
  });
});
