/**
 * The release check's fixture tree (docs-release, C284.2): a small repository in which every rule
 * of `pnpm release:check` passes in both modes. Each rule's test changes one file of it to see the
 * rule fail. Synthetic throughout: invented component names and versions only.
 */
import { createRepository, REPOSITORY_ROOT } from '../repository.js';
import { REQUIRED_KNOWN_ITEMS } from './known-items.js';

export const FIXTURE_PLAN = [
  '# Plan',
  '',
  '### C286. Deferred',
  '',
  '- **Connect:** sharing between two installs (the next release).',
  '- **Closed as moot:** an API gap Phase 9 built.',
  '',
  '### C287. Fixtures',
  '',
  '| Carried (earlier plans and the progress log) | Placement |',
  '|---|---|',
  '| Phase 1 "Production images are a later phase" | C257 |',
  '',
  '| Carried (Phases 7-10, after the plan) | Placement |',
  '|---|---|',
  '| 7C: R010 | open |',
  '',
  '## Release checklist (what must be true before the owner tags the release)',
  '',
  'This release ships the web platform and Android.',
  '',
  '**Built and green (agents and CI):**',
  '- [ ] First built line.',
  '- [ ] A line that depends on Phase 10 P2.',
  '',
  '**Owner steps and decisions (not agents):**',
  '- [ ] The owner tags.',
  '',
  '## Acceptance',
].join('\n');

const HEADER = '| Id | Line | State | Who | Evidence | Date |\n|---|---|---|---|---|---|';

export function fixtureChecklist(
  rows: readonly string[] = [],
  facts: { version?: string; image?: string; asOf?: string } = {},
): string {
  const known = REQUIRED_KNOWN_ITEMS.map(
    (item) =>
      `| ${item.id} | Known item ${item.id}. | done | ${item.owner} | \`docs/PROGRESS.md\` | 2026-11-20 |`,
  );
  return [
    '# Release checklist',
    '',
    'No iOS code, app or artifact ships in this release.',
    '',
    `- As of: \`${facts.asOf ?? '2026-11-20'}\``,
    `- Release version: \`${facts.version ?? '1.0.0'}\``,
    `- Shipped flow image: \`${facts.image ?? 'guidance'}\``,
    '',
    '## Built and green',
    '',
    HEADER,
    '| B01 | First built line. | done | orchestrator | `docs/PROGRESS.md` | 2026-11-20 |',
    '| B02 | A line that depends on Phase 10 P2. | done | orchestrator | `docs/PROGRESS.md` | 2026-11-20 |',
    '| O01 | The owner tags. | done | owner | `docs/PROGRESS.md` | 2026-11-20 |',
    '| 11D/slow-row | A slow row: missed. | done | owner | `docs/PROGRESS.md` | 2026-11-20 |',
    '| LIC-DEMO | demo-lib, a synthetic component | done | owner | `docs/PROGRESS.md` | 2026-11-20 |',
    ...known,
    ...rows,
    '',
    '## Open medium advisories (H14)',
    '',
    '| Advisory | Package | Severity | Published | Notes |',
    '|---|---|---|---|---|',
    '| GHSA-synthetic-0001 | demo-lib | medium | 2026-11-01 | recent |',
    '',
  ].join('\n');
}

export const FIXTURE_PROGRESS = [
  '# Progress',
  '',
  '| Phase | Title | Status |',
  '|---|---|---|',
  '| 9 | Dashboard | **done** (handover items P1-P9 pending) |',
  '| 10 | Android | **done** (owner items P1-P5 decided (P1 and P2 granted narrowly, P3 and P5 declined, P4 granted; the plan)) |',
  '| 11 | Connect | **in progress** (owner items Q1–Q12 granted) |',
  '',
  '## 2026-11-20: Phase 11, Workflow 11D done (performance)',
  '',
  'Built: five production images.',
  '',
  '**Known items.**',
  "- C286's deferrals (phase-11.plan.md), each with its reason",
  '',
  '## 2026-11-01: Phase 7 done',
  '',
  '**Owner items (defaults taken; nothing blocks):**',
  '- The notice wording stays at its default.',
  '',
  '**Carried forward:**',
  '- an older carry',
].join('\n');

export const FIXTURE_DEFERRALS = [
  '# Deferral placements',
  '',
  '| Source | Item | Placement |',
  '|---|---|---|',
  '| phase-11.plan.md C286 #1 | sharing between two installs | carried: "C286\'s deferrals (phase-11.plan.md), each with its reason" |',
  '| phase-11.plan.md C286 #2 | an API gap | moot: Phase 9 built it |',
  '| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 1 "Production images are a later phase" | built: "five production images" |',
  '| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7C: R010 | checklist: B01 |',
].join('\n');

export function summaryBlock(
  report: string,
  rows: readonly { id: string; verdict: string }[],
): string {
  const block = {
    schema: 'openverify/calibration-summary@1',
    report,
    workflow: '11D',
    status: 'published',
    'method-commit': null,
    base: null,
    head: null,
    machine: null,
    rows: rows.map((row) => ({
      id: row.id,
      title: `Row ${row.id}`,
      contract: 'C269.1',
      owner: 'calibration-load-11d',
      budget: null,
      verdict: row.verdict,
      median: null,
      unit: null,
      gap: null,
      configuration: 'default',
      takes: [],
    })),
  };
  return [
    `# ${report}`,
    '',
    '<!-- openverify:calibration-summary:start -->',
    '```json',
    JSON.stringify(block, null, 2),
    '```',
    '<!-- openverify:calibration-summary:end -->',
    '',
  ].join('\n');
}

const STAGED_RUN = JSON.stringify({
  schema: 'openverify/staged-run@1',
  'run-id': '1',
  commit: 'synthetic',
  date: '2026-11-20',
  images: [{ name: 'openverify/api', digest: 'sha256:synthetic' }],
  artifacts: [{ path: 'SHA256SUMS', sha256: 'synthetic' }],
  'licence-reports': [{ artifact: 'image:api', result: 'pass', owner: [] }],
});

/** The whole fixture tree, every rule passing. */
export function fixtureFiles(): Record<string, string> {
  const schema = createRepository(REPOSITORY_ROOT).readText(
    'contracts/fixtures/calibration/summary.schema.json',
  );
  const pkg = (name: string): string => `{\n  "name": "${name}",\n  "version": "1.0.0"\n}\n`;
  return {
    'docs/plans/phase-11.plan.md': FIXTURE_PLAN,
    'docs/release/checklist.md': fixtureChecklist(),
    'docs/release/deferrals.md': FIXTURE_DEFERRALS,
    'docs/PROGRESS.md': FIXTURE_PROGRESS,
    'docs/PLAN.md': '# PLAN\n\n### Next release: iOS\n- an iOS app\n',
    'package.json': pkg('root'),
    'packages/node/package.json': pkg('@openverify/node'),
    'packages/sdk-js/package.json': pkg('@openverify/js'),
    'packages/sdk-react/package.json': pkg('@openverify/react'),
    'packages/node/src/transport.ts': "export const CLIENT_USER_AGENT = 'openverify-node/1.0.0';\n",
    'deploy/helm/openverify/Chart.yaml': "apiVersion: v2\nversion: 1.0.0\nappVersion: '1.0.0'\n",
    'android/gradle.properties': 'openverifyVersion=1.0.0\n',
    'android/CHANGELOG.md': [
      '# Changelog',
      '',
      '## 1.0.0 (2026-11-20)',
      '',
      '- Minimum server: any.',
      '- minSdk 26.',
      '- Compile and target SDK: 36.',
      '',
    ].join('\n'),
    'THIRD_PARTY_LICENSES.md': '| Component | Licence |\n|---|---|\n| demo-lib | MIT |\n',
    'contracts/fixtures/calibration/summary.schema.json': schema,
    'docs/calibration/load-phase11.md': summaryBlock('docs/calibration/load-phase11.md', [
      { id: 'slow-row', verdict: 'missed' },
      { id: 'fast-row', verdict: 'met' },
    ]),
    'docs/calibration/watchlist-phase11.md': summaryBlock('docs/calibration/watchlist-phase11.md', [
      { id: 'kept-row', verdict: 'kept' },
    ]),
    'docs/calibration/lists-phase11.md': summaryBlock('docs/calibration/lists-phase11.md', [
      { id: 'cap-row', verdict: 'reported' },
    ]),
    'docs/release/verified-findings.md': [
      '| Finding | Severity | Verdict | Fixed | Commits | Summary |',
      '|---|---|---|---|---|---|',
      '| F001 | HIGH | refuted | no | none | not a defect |',
      '| F002 | CRITICAL | confirmed | yes | abc1234 | fixed |',
      '| F003 | MEDIUM | confirmed | no | none | later |',
    ].join('\n'),
    'docs/release/staged-run.json': STAGED_RUN,
    'models/manifest.json': '{"models": []}\n',
    'deploy/helm/openverify/files/models-manifest.json': '{"models": []}\n',
  };
}
