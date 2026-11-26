/**
 * C284.2: every rule of `pnpm release:check`, each with a passing fixture (the base tree, where all
 * of them pass in both modes) and a failing one (the base with one file changed).
 */
import { describe, expect, it } from 'vitest';
import { EXIT_FAILED, EXIT_OK, runCli } from '../cli.js';
import { createMemoryRepository, createRepository, REPOSITORY_ROOT } from '../repository.js';
import type { CheckFinding, CheckResult, Repository } from '../types.js';
import { checkRelease, releaseCheck } from './index.js';
import {
  FIXTURE_DEFERRALS,
  FIXTURE_PROGRESS,
  fixtureChecklist,
  fixtureFiles,
  summaryBlock,
} from './release-check.fixtures.js';
import {
  lineStateFindings,
  runReleaseCheck,
  securityFindings,
  type ReleaseCheckDeps,
} from './release-check.js';

const BUILT: readonly CheckResult[] = [{ name: 'threat-model', status: 'built', findings: [] }];
const DEPS: ReleaseCheckDeps = { security: () => BUILT, notes: () => [] };

function repoWith(changes: Record<string, string | null> = {}): Repository {
  const files: Record<string, string> = fixtureFiles();
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) {
      Reflect.deleteProperty(files, path);
    } else {
      files[path] = text;
    }
  }
  return createMemoryRepository(files);
}

function run(
  repo: Repository,
  tag = false,
  deps: ReleaseCheckDeps = DEPS,
): readonly CheckFinding[] {
  return runReleaseCheck(repo, { tag }, deps).findings;
}

const summary = (findings: readonly CheckFinding[]): string[] =>
  findings.map((finding) => `${finding.severity} ${finding.rule}: ${finding.message}`);

describe('the base fixture', () => {
  it('passes every rule in both modes', () => {
    expect(summary(run(repoWith()))).toEqual([]);
    expect(summary(run(repoWith(), true))).toEqual([]);
    expect(runReleaseCheck(repoWith(), { tag: true }, DEPS)).toMatchObject({
      name: 'release:check',
      mode: 'tag',
      status: 'built',
    });
  });

  it('exits 0 in the default mode and 1 with --tag on an owner item, through the CLI', () => {
    const repo = repoWith({ 'docs/release/staged-run.json': null });
    const lines: string[] = [];
    const deps = {
      repo,
      write: () => undefined,
      out: (line: string) => lines.push(line),
      err: (line: string) => lines.push(line),
      releaseCheck: (r: Repository, options: { tag: boolean }) => runReleaseCheck(r, options, DEPS),
    };
    expect(runCli(['release-check'], deps)).toBe(EXIT_OK);
    expect(runCli(['release-check', '--tag'], deps)).toBe(EXIT_FAILED);
    expect(lines).toContain('release:check (default): 0 errors, 1 owner items');
  });
});

describe('rule: done lines cite evidence that exists (checklist)', () => {
  it('fails a done line whose evidence does not exist', () => {
    const repo = repoWith({
      'docs/release/checklist.md': fixtureChecklist([
        '| X01 | An extra line. | done | a | `docs/missing.md` | 2026-11-20 |',
      ]),
    });
    expect(summary(run(repo))).toEqual([
      'error checklist-evidence: X01 cites docs/missing.md, which does not exist',
    ]);
  });
});

describe('rule: the threat model, ASVS and MASVS checks pass (security)', () => {
  it('fails while docs-security has not built them, and passes its findings through', () => {
    expect(
      summary(securityFindings([{ name: 'threat-model', status: 'not-built', findings: [] }])),
    ).toEqual([
      'error security: threat-model: not built yet (docs-security): the threat model, ASVS and MASVS checks must pass (C284.2)',
    ]);
    const failing: ReleaseCheckDeps = {
      ...DEPS,
      security: () => [
        {
          name: 'asvs',
          status: 'built',
          findings: [{ rule: 'evidence', path: 'a.csv', message: 'gone', severity: 'error' }],
        },
      ],
    };
    expect(summary(run(repoWith(), false, failing))).toEqual(['error security/evidence: gone']);
  });
});

describe('rule: no gap row lacks a phase or a release (gap-row)', () => {
  const csv = (notes: string): string =>
    `id,level,status,evidence,notes,threats,reviewed_at,reviewed_commit\nv5.0.0-1.1.1,1,gap,,"${notes}",,2026-11-20,abc\n`;
  const model = (owner: string): string =>
    `| id | boundary | STRIDE | threat | status | evidence | mitigation or owner |\n|---|---|---|---|---|---|---|\n| B1-S1 | B1 | S | x | gap | | ${owner} |\n`;

  it('passes a gap that names a phase, a Workflow, the next release or a finding', () => {
    const repo = repoWith({
      'docs/security/asvs-5.0.0-l2.csv': csv('the next release'),
      'docs/security/masvs-2.1.0.csv': csv('Workflow 11F'),
      'docs/security/threat-model.md': model('finding KP11-10'),
    });
    expect(summary(run(repo))).toEqual([]);
  });

  it('fails a gap that names none, in each of the three documents', () => {
    const repo = repoWith({
      'docs/security/asvs-5.0.0-l2.csv': csv('later'),
      'docs/security/masvs-2.1.0.csv': csv('someday'),
      'docs/security/threat-model.md': model('to do'),
    });
    expect(summary(run(repo))).toEqual([
      'error gap-row: v5.0.0-1.1.1 is a gap that names no phase, release or finding',
      'error gap-row: v5.0.0-1.1.1 is a gap that names no phase, release or finding',
      'error gap-row: B1-S1 is a gap that names no phase, release or finding',
    ]);
  });
});

describe('rule: every owner item has its state in PROGRESS (owner-state)', () => {
  it('reads Phase 10 P1-P5 from its row in prose, never Phase 9 P1-P9', () => {
    expect(summary(run(repoWith()))).toEqual([]);
  });

  it('reports a pending item as owner and a missing one with the line to add', () => {
    const progress = FIXTURE_PROGRESS.replace('Q1–Q12 granted', 'Q1–Q11 pending').replace(
      'P4 granted',
      'P4 pending the owner',
    );
    const findings = run(repoWith({ 'docs/PROGRESS.md': progress }));
    expect(findings.every((finding) => finding.severity === 'owner')).toBe(true);
    expect(summary(findings)).toContain(
      'owner owner-state: owner: Q3 is pending; C289’s default holds and the release notes state its outcome'.replace(
        '’',
        "'",
      ),
    );
    expect(summary(findings)).toContain(
      'owner owner-state: orchestrator: PROGRESS records no state for Q12: add "**Q12:** <granted|declined|pending>" to the newest entry, or name Q12 in Phase 11\'s row of the phase table',
    );
    expect(summary(findings)).toContain(
      "owner owner-state: owner: Phase 10 P4 is pending; C289's default holds and the release notes state its outcome",
    );
    expect(findings.filter((finding) => finding.rule === 'owner-state')).toHaveLength(13);
  });

  it('takes a later **Qn:** line over the phase table', () => {
    const progress = FIXTURE_PROGRESS.replace(
      '**Known items.**',
      '**Q12:** pending; Locust not adopted.\n\n**Known items.**',
    );
    expect(summary(run(repoWith({ 'docs/PROGRESS.md': progress })))).toEqual([
      "owner owner-state: owner: Q12 is pending; C289's default holds and the release notes state its outcome",
    ]);
  });

  it('asks for Phase 10 P-items in its row when none is recorded', () => {
    const progress = FIXTURE_PROGRESS.replace(
      '(P1 and P2 granted narrowly, P3 and P5 declined, P4 granted; the plan)',
      '',
    );
    const findings = summary(run(repoWith({ 'docs/PROGRESS.md': progress })));
    expect(findings).toHaveLength(7);
    expect(findings[0]).toBe(
      'owner owner-state: orchestrator: PROGRESS records no state for Phase 10 P1: add "P1 <granted|declined|pending>" to Phase 10\'s row of the phase table',
    );
    expect(findings[5]).toContain('owner flow-image');
    expect(findings[6]).toContain('error p2-dependency: B02');
  });
});

describe('rule: the version strings agree (version)', () => {
  it('reports each disagreement with the exact change, as an owner item', () => {
    const repo = repoWith({
      'packages/node/package.json': '{\n  "name": "n",\n  "version": "0.0.0"\n}\n',
      'packages/node/src/transport.ts':
        "export const CLIENT_USER_AGENT = 'openverify-node/0.0.0';\n",
      'deploy/helm/openverify/Chart.yaml': "version: 1.0.0\nappVersion: '0.9.0'\n",
    });
    expect(summary(run(repo))).toEqual([
      'owner version: orchestrator: @openverify/node is 0.0.0, not the release\'s 1.0.0: change packages/node/package.json:3 from "0.0.0" to "1.0.0"',
      'owner version: orchestrator: @openverify/node\'s CLIENT_USER_AGENT is 0.0.0, not the release\'s 1.0.0: change packages/node/src/transport.ts:1 from "0.0.0" to "1.0.0"',
      'owner version: orchestrator: the chart\'s appVersion is 0.9.0, not the release\'s 1.0.0: change deploy/helm/openverify/Chart.yaml:2 from "0.9.0" to "1.0.0"',
    ]);
  });

  it('reads an undated changelog entry by its "Version" line and asks for its date', () => {
    const repo = repoWith({
      'android/CHANGELOG.md':
        '# Changelog\n\n## Unreleased\n\nVersion 1.0.0. Nothing published.\n\n- Minimum server: any.\n- minSdk 26.\n- Compile SDK 36.\n',
    });
    expect(summary(run(repo))).toEqual([
      'owner version: orchestrator, at the tag: date the changelog\'s entry: change "## Unreleased" to "## 1.0.0 (<the tag\'s date>)"',
    ]);
  });

  it('fails a changelog entry without its minimum server, minSdk or compileSdk, and a missing file', () => {
    const repo = repoWith({
      'android/CHANGELOG.md': '# Changelog\n\n## 1.0.0 (2026-11-20)\n\n- Nothing else.\n',
      'android/gradle.properties': null,
    });
    expect(summary(run(repo))).toEqual([
      "error version: the Android SDK's openverifyVersion: android/gradle.properties does not exist",
      "error version: the changelog's newest entry does not state its minimum server",
      "error version: the changelog's newest entry does not state its minSdk",
      "error version: the changelog's newest entry does not state its compileSdk",
    ]);
  });

  it('fails a source whose version cannot be read', () => {
    const repo = repoWith({ 'packages/sdk-js/package.json': '{}\n' });
    expect(summary(run(repo))).toEqual(['error version: @openverify/js: no version string found']);
  });
});

describe('rule: every deferral is placed (deferral)', () => {
  it('fails an item with no placement row and a row that matches no item', () => {
    const deferrals = FIXTURE_DEFERRALS.replace(
      '| phase-11.plan.md C286 #2 | an API gap | moot: Phase 9 built it |',
      '| phase-11.plan.md C286 #2 | not in the item | moot: Phase 9 built it |',
    );
    const findings = summary(run(repoWith({ 'docs/release/deferrals.md': deferrals })));
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatch(/^error deferral: phase-11\.plan\.md C286 #2 has no placement row/);
    expect(findings[1]).toBe(
      'error deferral: phase-11.plan.md C286 #2: "not in the item" matches no item',
    );
  });

  it('reports a carried placement PROGRESS does not hold with the exact line to add', () => {
    const progress = FIXTURE_PROGRESS.replace(
      "- C286's deferrals (phase-11.plan.md), each with its reason",
      '- something else',
    );
    expect(summary(run(repoWith({ 'docs/PROGRESS.md': progress })))).toEqual([
      'owner deferral: orchestrator: add to PROGRESS, under the next entry\'s "**Carried forward:**", the line "- C286\'s deferrals (phase-11.plan.md), each with its reason" (it places phase-11.plan.md C286 #1)',
    ]);
  });

  it('finds a carried placement in PLAN’s "Next release" sections too', () => {
    const repo = repoWith({
      'docs/release/deferrals.md': FIXTURE_DEFERRALS.replace(
        'carried: "C286\'s deferrals (phase-11.plan.md), each with its reason"',
        'carried: "an iOS app"',
      ),
    });
    expect(summary(run(repo))).toEqual([]);
  });

  it('checks a built, handed and checklist placement, and refuses a malformed one', () => {
    const deferrals = FIXTURE_DEFERRALS.replace(
      'built: "five production images"',
      'built: "six images"',
    )
      .replace('checklist: B01', 'checklist: Z99')
      .replace('moot: Phase 9 built it', 'handed: docs/plans/phase-99.plan.md')
      .replace(
        'carried: "C286\'s deferrals (phase-11.plan.md), each with its reason"',
        'somewhere',
      );
    expect(summary(run(repoWith({ 'docs/release/deferrals.md': deferrals })))).toEqual([
      'error deferral: phase-11.plan.md C286 #1: "somewhere" is not a placement',
      'error deferral: phase-11.plan.md C286 #2 is handed to docs/plans/phase-99.plan.md, which does not exist',
      'owner deferral: orchestrator: phase-11.plan.md Carried (earlier plans and the progress log) is placed as built by Phase 11, but no Phase 11 Workflow entry of PROGRESS says "six images"',
      'error deferral: phase-11.plan.md Carried (Phases 7-10, after the plan) is placed on the checklist as Z99, which has no line',
    ]);
  });

  it('fails when the placements file is missing', () => {
    expect(summary(run(repoWith({ 'docs/release/deferrals.md': null })))).toEqual([
      'error deferral: docs/release/deferrals.md does not exist: no item is placed',
    ]);
  });
});

describe('rule: every pending licence row is listed (licence-row)', () => {
  const licences = (component: string, words: string): string =>
    `| Component | Licence |\n|---|---|\n| ${component} 2.0.1 | MIT-0; ${words} |\n`;

  it('reports a listed row as an owner item', () => {
    const repo = repoWith({ 'THIRD_PARTY_LICENSES.md': licences('demo-lib', 'owner to confirm') });
    expect(summary(run(repo))).toEqual([
      'owner licence-row: owner: demo-lib 2.0.1 reads "owner to confirm" (listed on the checklist)',
    ]);
  });

  it('fails a row the checklist does not list', () => {
    const repo = repoWith({ 'THIRD_PARTY_LICENSES.md': licences('other-lib', 'accepted pending') });
    expect(summary(run(repo))).toEqual([
      'error licence-row: other-lib 2.0.1 (THIRD_PARTY_LICENSES.md:3, "pending") is not listed on the checklist',
    ]);
  });
});

describe('rule: Phase 10 P2 and the flow image (p2-dependency, flow-image)', () => {
  const p2Pending = FIXTURE_PROGRESS.replace(
    'P1 and P2 granted narrowly, P3 and P5 declined, P4 granted',
    'P1 granted narrowly, P3 and P5 declined, P4 granted, P2 pending',
  );

  it('refuses a done line that depends on P2 while P2 is open and the guidance image ships', () => {
    expect(summary(run(repoWith({ 'docs/PROGRESS.md': p2Pending })))).toEqual([
      "owner owner-state: owner: Phase 10 P2 is pending; C289's default holds and the release notes state its outcome",
      "owner flow-image: owner: the flow image with onnxruntime-web is the shipped one while Phase 10 P2 is pending: ship the -noguidance build (C289) or record P2's grant",
      'error p2-dependency: B02 depends on Phase 10 P2 and reads done while P2 is pending and the release does not ship the decline outcome (H20)',
    ]);
  });

  it('passes when the release ships the decline outcome', () => {
    const repo = repoWith({
      'docs/PROGRESS.md': p2Pending,
      'docs/release/checklist.md': fixtureChecklist([], { image: 'noguidance' }),
    });
    expect(summary(run(repo))).toEqual([
      "owner owner-state: owner: Phase 10 P2 is pending; C289's default holds and the release notes state its outcome",
    ]);
  });
});

describe("rule: the 11F verifier's table holds no unfixed CRITICAL or HIGH (verifier-table)", () => {
  it('reports the table pending (11F) while it does not exist: default exits 0, --tag refuses', () => {
    const findings = run(repoWith({ 'docs/release/verified-findings.md': null }));
    expect(summary(findings)).toEqual([
      "owner verifier-table: 11F: the verifier's table does not exist yet: pending (11F); --tag refuses a release without it",
    ]);
  });

  it('fails both modes on a confirmed or plausible HIGH that is not fixed', () => {
    const table =
      (fixtureFiles()['docs/release/verified-findings.md'] ?? '') +
      '\n| F004 | HIGH | plausible | no | none | open |';
    const repo = repoWith({ 'docs/release/verified-findings.md': table });
    const expected = [
      'error verifier-table: F004 (HIGH, plausible) is not fixed: a confirmed CRITICAL or HIGH is never closed by a record',
    ];
    expect(summary(run(repo))).toEqual(expected);
    expect(summary(run(repo, true))).toEqual(expected);
  });

  // F006 (Workflow 11F review): a cell outside the frozen vocabulary must never let a row through.
  it.each([
    [
      '| F7 | High (auth) | confirmed | no | | open |',
      'error verifier-table: F7: Severity "High (auth)" is not one of CRITICAL, HIGH, MEDIUM, LOW',
    ],
    [
      '| F8 | H | confirmed | no | | open |',
      'error verifier-table: F8: Severity "H" is not one of CRITICAL, HIGH, MEDIUM, LOW',
    ],
    [
      '| F9 | MEDIUM | refuted-ish | no | | open |',
      'error verifier-table: F9: Verdict "refuted-ish" is not one of refuted, confirmed, plausible',
    ],
    [
      '| F10 | HIGH | confirmed | yes? | abc1234 | fixed |',
      'error verifier-table: F10: Fixed "yes?" is not yes or no',
    ],
    [
      '| F11 | HIGH | confirmed | yes | | fixed |',
      'error verifier-table: F11: Fixed is yes but Commits names no commit',
    ],
  ])('fails both modes on a malformed row: %s', (row, message) => {
    const table = (fixtureFiles()['docs/release/verified-findings.md'] ?? '') + `\n${row}`;
    const repo = repoWith({ 'docs/release/verified-findings.md': table });
    expect(summary(run(repo))).toEqual([message]);
    expect(summary(run(repo, true))).toEqual([message]);
  });

  it('passes a fixed HIGH with its commits and a refuted CRITICAL', () => {
    const table =
      (fixtureFiles()['docs/release/verified-findings.md'] ?? '') +
      '\n| F12 | HIGH | confirmed | yes | abc1234, def5678 | fixed |' +
      '\n| F13 | CRITICAL | refuted | no | | refuted at 0.9 |';
    expect(summary(run(repoWith({ 'docs/release/verified-findings.md': table })))).toEqual([]);
  });

  it('fails a table without the frozen header', () => {
    const repo = repoWith({ 'docs/release/verified-findings.md': '| A |\n|---|\n| b |\n' });
    expect(summary(run(repo))).toEqual([
      'error verifier-table: no table with the header | Finding | Severity | Verdict | Fixed | Commits | Summary |',
    ]);
  });
});

describe('rule: mediums past their time frame are listed (medium-advisory)', () => {
  it('lists a medium published more than 90 days before the checklist’s date', () => {
    const repo = repoWith({
      'docs/release/checklist.md': fixtureChecklist([], { asOf: '2027-03-01' }),
    });
    expect(summary(run(repo))).toEqual([
      'owner medium-advisory: owner: GHSA-synthetic-0001 (demo-lib, medium) was published 120 days before 2027-03-01, past its 90-day time frame',
    ]);
  });

  it('fails a medium without a publication date', () => {
    const repo = repoWith({
      'docs/release/checklist.md': fixtureChecklist().replace('2026-11-01', 'soon'),
    });
    expect(summary(run(repo))).toEqual([
      'error medium-advisory: GHSA-synthetic-0001: "soon" is not a publication date (YYYY-MM-DD)',
    ]);
  });
});

describe('rule: the staged run and its licence reports (staged-run)', () => {
  it('reports "staged run pending" while no run is recorded', () => {
    expect(summary(run(repoWith({ 'docs/release/staged-run.json': null })))).toEqual([
      'owner staged-run: orchestrator: no staged release.yml run is recorded: the image digests, checksums and SBOM licence reports are "staged run pending" (KP10-59)',
    ]);
  });

  it('reports each licence report that is not a pass as an owner item (KP11-47 (b))', () => {
    const record = JSON.parse(fixtureFiles()['docs/release/staged-run.json'] ?? '{}') as Record<
      string,
      unknown
    >;
    record['licence-reports'] = [
      {
        artifact: 'image:vision',
        result: 'fail',
        owner: [{ name: 'opencv-python-headless', reason: 'bundles FFmpeg' }],
      },
    ];
    expect(
      summary(run(repoWith({ 'docs/release/staged-run.json': JSON.stringify(record) }))),
    ).toEqual([
      'owner staged-run: owner: image:vision\'s licence check is "fail" (opencv-python-headless): a decision or a built decline outcome is needed',
    ]);
  });

  it('fails a malformed record', () => {
    expect(summary(run(repoWith({ 'docs/release/staged-run.json': '{' })))).toEqual([
      'error staged-run: the record is not JSON',
    ]);
    expect(summary(run(repoWith({ 'docs/release/staged-run.json': '{"schema": "x"}' })))).toEqual([
      "error staged-run: the record's schema is not openverify/staged-run@1",
    ]);
    expect(
      summary(
        run(repoWith({ 'docs/release/staged-run.json': '{"schema": "openverify/staged-run@1"}' })),
      ),
    ).toEqual(['error staged-run: the record lacks run-id, commit or date']);
    expect(
      summary(
        run(
          repoWith({
            'docs/release/staged-run.json':
              '{"schema": "openverify/staged-run@1", "run-id": "1", "commit": "c", "date": "d", "images": {}}',
          }),
        ),
      ),
    ).toEqual([
      'error staged-run: the record lacks images, artifacts or licence-reports in their shape',
    ]);
  });
});

describe("rule: the chart's models manifest is a copy (models-manifest, KP11-47 (c))", () => {
  it('fails a copy that differs', () => {
    const repo = repoWith({ 'deploy/helm/openverify/files/models-manifest.json': '{}\n' });
    expect(summary(run(repo))).toEqual([
      "error models-manifest: the chart's copy differs from models/manifest.json (or one is missing): copy models/manifest.json over it",
    ]);
  });
});

describe('rule: each 11D row not met has a checklist line (calibration, KP11-49)', () => {
  it('fails a missed row without its line, and a report without its block', () => {
    const repo = repoWith({
      'docs/calibration/load-phase11.md': summaryBlock('docs/calibration/load-phase11.md', [
        { id: 'slow-row', verdict: 'missed' },
        { id: 'new-row', verdict: 'invalid' },
      ]),
      'docs/calibration/lists-phase11.md': '# no block\n',
    });
    expect(summary(run(repo))).toEqual([
      'error calibration: no calibration summary block',
      "error calibration: docs/calibration/load-phase11.md's row new-row is invalid and has no checklist line 11D/new-row (KP11-49)",
    ]);
  });
});

describe('the checklist lines in each mode (checklist-state)', () => {
  it('reports owner and CI-pending lines in the default mode, and every line not done with --tag', () => {
    const repo = repoWith({
      'docs/release/checklist.md': fixtureChecklist([
        '| X01 | Waits on the owner. | owner | owner | none | 2026-11-20 |',
        '| X02 | Waits on CI. | ci-pending | orchestrator | none | 2026-11-20 |',
        '| X03 | An agent closes it. | open | 11F | none | 2026-11-20 |',
      ]),
    });
    expect(summary(run(repo))).toEqual([
      'owner checklist-state: X01 is owner (owner)',
      'owner checklist-state: X02 is ci-pending (orchestrator)',
    ]);
    expect(summary(run(repo, true))).toEqual([
      'owner checklist-state: X01 is owner (owner)',
      'owner checklist-state: X02 is ci-pending (orchestrator)',
      'owner checklist-state: X03 is open (11F)',
    ]);
    expect(lineStateFindings(null, true)).toEqual([]);
  });
});

describe('the committed records (C284.2 over the real tree)', () => {
  const real = createRepository(REPOSITORY_ROOT);

  it('has no error in the default mode: every item it reports is the owner’s, the orchestrator’s or 11F’s', () => {
    const findings = runReleaseCheck(real, { tag: false }, { ...DEPS, notes: () => [] }).findings;
    expect(findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    for (const finding of findings) {
      expect(finding.message, finding.message).toMatch(
        /^(?:owner|orchestrator|11F|[A-Z0-9][\w./-]* is (?:owner|ci-pending))/,
      );
    }
  });

  it('is refused by --tag today: the release has open, owner and CI-pending lines', () => {
    const findings = runReleaseCheck(real, { tag: true }, DEPS).findings;
    expect(findings.some((finding) => finding.message.startsWith('KP10-59 is ci-pending'))).toBe(
      true,
    );
    expect(findings.some((finding) => finding.message.startsWith('B01 is open'))).toBe(true);
  });

  it('runs the real entry points', () => {
    expect(releaseCheck(real, { tag: false })).toMatchObject({ mode: 'default', status: 'built' });
    expect(checkRelease(real).flatMap((result) => result.findings)).toEqual([]);
  });
});
