/**
 * C284.2's deferral rule (docs-release; reviews H25 and its verification): every item of each
 * plan's "Deferred" section (C88, C110, C145, C177, C223, C286), every row of C288's "Carried
 * (earlier plans and the progress log)" table and every row of contracts-11e's "Carried (Phases
 * 7-10, after the plan)" table is placed: carried in PROGRESS or PLAN's "Next release", built by a
 * Phase 11 Workflow, handed to a later phase's plan, a line of the release checklist, or closed as
 * moot with its reason.
 *
 * The placements live in `docs/release/deferrals.md`, one row per item. What PROGRESS must hold is
 * the orchestrator's to write, so a carried or built placement PROGRESS does not hold yet is
 * reported with the exact line to add (an `owner` finding: the default mode exits 0 on it, `--tag`
 * refuses it); a missing or stale placement row is docs-release's own error.
 */
import type { CheckFinding, Repository } from '../types.js';
import { CHECKLIST_PATH, parseChecklist } from './checklist.js';
import { tablesOf } from './markdown.js';
import {
  PLAN_MASTER_PATH,
  PROGRESS_PATH,
  carryRegions,
  nextReleaseSections,
  phase11Entries,
} from './progress.js';

export const DEFERRALS_PATH = 'docs/release/deferrals.md';

/** The plans' Deferred sections C284.2 names, by file and heading. */
export const DEFERRED_SECTIONS: readonly { readonly plan: string; readonly heading: string }[] = [
  { plan: 'docs/plans/phase-6.plan.md', heading: '### C88. Deferred' },
  { plan: 'docs/plans/phase-7.plan.md', heading: '### C110. Deferred' },
  { plan: 'docs/plans/phase-8.plan.md', heading: '### C145. Deferred' },
  { plan: 'docs/plans/phase-9.plan.md', heading: '### C177. Deferred' },
  { plan: 'docs/plans/phase-10.plan.md', heading: '### C223. Deferred' },
  { plan: 'docs/plans/phase-11.plan.md', heading: '### C286. Deferred' },
];

/** The carried tables C284.2 and contracts-11e's amendment 10 name, by their first header cell. */
export const CARRIED_TABLES: readonly { readonly plan: string; readonly header: string }[] = [
  {
    plan: 'docs/plans/phase-11.plan.md',
    header: 'Carried (earlier plans and the progress log)',
  },
  { plan: 'docs/plans/phase-11.plan.md', header: 'Carried (Phases 7-10, after the plan)' },
];

/** One item that must be placed. */
export interface DeferredItem {
  /** `phase-7.plan.md C110 #3` for a Deferred item; `phase-11.plan.md <table header>` for a row. */
  readonly source: string;
  /** The item's whole text (a Deferred item) or its first cell (a table row). */
  readonly text: string;
  readonly path: string;
  readonly line: number;
}

/** The placement kinds of `docs/release/deferrals.md`. */
export type Placement =
  | { readonly kind: 'carried'; readonly text: string }
  | { readonly kind: 'built'; readonly text: string }
  | { readonly kind: 'handed'; readonly plan: string }
  | { readonly kind: 'checklist'; readonly id: string }
  | { readonly kind: 'moot'; readonly reason: string };

export interface PlacementRow {
  readonly source: string;
  /** For a Deferred item a phrase its text holds; for a table row its first cell, exactly. */
  readonly item: string;
  readonly placement: Placement | null;
  readonly raw: string;
  readonly line: number;
}

const fileOf = (plan: string): string => plan.slice(plan.lastIndexOf('/') + 1);

/** The top-level items (bullets, or paragraphs where a section has no bullets) of each section. */
export function deferredItems(repo: Repository): readonly DeferredItem[] {
  const items: DeferredItem[] = [];
  for (const { plan, heading } of DEFERRED_SECTIONS) {
    if (!repo.exists(plan)) {
      continue;
    }
    const lines = repo.readText(plan).split('\n');
    const start = lines.findIndex((line) => line.trimEnd() === heading);
    if (start < 0) {
      continue;
    }
    const contract = heading.replace(/^### /, '').replace(/\. Deferred$/, '');
    let count = 0;
    let current: { text: string[]; line: number } | null = null;
    const flush = (): void => {
      if (current !== null) {
        count += 1;
        items.push({
          source: `${fileOf(plan)} ${contract} #${String(count)}`,
          text: current.text.join(' '),
          path: plan,
          line: current.line,
        });
        current = null;
      }
    };
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.startsWith('#')) {
        break;
      }
      if (line.startsWith('- ') || (line !== '' && !line.startsWith(' ') && current === null)) {
        flush();
        current = { text: [line.replace(/^- /, '')], line: index + 1 };
      } else if (line.startsWith(' ') && current !== null) {
        current.text.push(line.trim());
      } else if (line === '') {
        flush();
      }
    }
    flush();
  }
  for (const { plan, header } of CARRIED_TABLES) {
    if (!repo.exists(plan)) {
      continue;
    }
    for (const table of tablesOf(repo.readText(plan))) {
      if (table.header[0] !== header) {
        continue;
      }
      for (const row of table.rows) {
        items.push({
          source: `${fileOf(plan)} ${header}`,
          text: row.cells[0] ?? '',
          path: plan,
          line: row.line,
        });
      }
    }
  }
  return items;
}

const QUOTED = /^"([^"]+)"$/;

/** Reads one placement cell: `carried: "..."`, `built: "..."`, `handed: <plan>`, `checklist: <id>`, `moot: <reason>`. */
export function parsePlacement(cell: string): Placement | null {
  const colon = cell.indexOf(':');
  if (colon < 0) {
    return null;
  }
  const kind = cell.slice(0, colon).trim();
  const value = cell
    .slice(colon + 1)
    .trim()
    .replaceAll('`', '');
  const quoted = QUOTED.exec(value)?.[1];
  switch (kind) {
    case 'carried':
    case 'built':
      return quoted === undefined ? null : { kind, text: quoted };
    case 'handed':
      return value === '' ? null : { kind, plan: value };
    case 'checklist':
      return value === '' ? null : { kind, id: value };
    case 'moot':
      return value === '' ? null : { kind, reason: value };
    default:
      return null;
  }
}

/** The rows of `docs/release/deferrals.md` (`| Source | Item | Placement |`). */
export function parsePlacements(text: string): readonly PlacementRow[] {
  return tablesOf(text)
    .filter((table) => table.header.join('|') === 'Source|Item|Placement')
    .flatMap((table) =>
      table.rows.map((row) => ({
        source: row.cells[0] ?? '',
        item: row.cells[1] ?? '',
        placement: parsePlacement(row.cells[2] ?? ''),
        raw: row.cells[2] ?? '',
        line: row.line,
      })),
    );
}

const matches = (row: PlacementRow, item: DeferredItem): boolean =>
  row.source === item.source &&
  (item.source.includes('#') ? item.text.includes(row.item) : item.text === row.item);

const finding = (
  severity: CheckFinding['severity'],
  message: string,
  path = DEFERRALS_PATH,
  line?: number,
): CheckFinding => ({
  rule: 'deferral',
  path,
  ...(line === undefined ? {} : { line }),
  message,
  severity,
});

/** C284.2's deferral rule. */
export function deferralFindings(repo: Repository): readonly CheckFinding[] {
  const items = deferredItems(repo);
  if (!repo.exists(DEFERRALS_PATH)) {
    return [finding('error', `${DEFERRALS_PATH} does not exist: no item is placed`)];
  }
  const rows = parsePlacements(repo.readText(DEFERRALS_PATH));
  const progress = repo.exists(PROGRESS_PATH) ? repo.readText(PROGRESS_PATH) : '';
  const carried = [
    ...carryRegions(progress).map((region) => region.text),
    ...(repo.exists(PLAN_MASTER_PATH) ? nextReleaseSections(repo.readText(PLAN_MASTER_PATH)) : []),
  ];
  const built = phase11Entries(progress).map((entry) => entry.text);
  const checklistIds = new Set(
    repo.exists(CHECKLIST_PATH)
      ? parseChecklist(repo.readText(CHECKLIST_PATH)).lines.map((line) => line.id)
      : [],
  );
  const findings: CheckFinding[] = [];
  for (const item of items) {
    if (!rows.some((row) => matches(row, item))) {
      findings.push(
        finding(
          'error',
          `${item.source} has no placement row ("${item.text.slice(0, 80)}")`,
          item.path,
          item.line,
        ),
      );
    }
  }
  const missingLines = new Map<string, string[]>();
  for (const row of rows) {
    if (!items.some((item) => matches(row, item))) {
      findings.push(
        finding('error', `${row.source}: "${row.item}" matches no item`, DEFERRALS_PATH, row.line),
      );
      continue;
    }
    const placement = row.placement;
    if (placement === null) {
      findings.push(
        finding(
          'error',
          `${row.source}: "${row.raw}" is not a placement`,
          DEFERRALS_PATH,
          row.line,
        ),
      );
      continue;
    }
    switch (placement.kind) {
      case 'carried':
        if (!carried.some((text) => text.includes(placement.text))) {
          missingLines.set(placement.text, [
            ...(missingLines.get(placement.text) ?? []),
            row.source,
          ]);
        }
        break;
      case 'built':
        if (!built.some((text) => text.includes(placement.text))) {
          findings.push(
            finding(
              'owner',
              `orchestrator: ${row.source} is placed as built by Phase 11, but no Phase 11 Workflow entry of PROGRESS says "${placement.text}"`,
              DEFERRALS_PATH,
              row.line,
            ),
          );
        }
        break;
      case 'handed':
        if (!repo.exists(placement.plan)) {
          findings.push(
            finding(
              'error',
              `${row.source} is handed to ${placement.plan}, which does not exist`,
              DEFERRALS_PATH,
              row.line,
            ),
          );
        }
        break;
      case 'checklist':
        if (!checklistIds.has(placement.id)) {
          findings.push(
            finding(
              'error',
              `${row.source} is placed on the checklist as ${placement.id}, which has no line`,
              DEFERRALS_PATH,
              row.line,
            ),
          );
        }
        break;
      case 'moot':
        break;
    }
  }
  for (const [text, sources] of missingLines) {
    findings.push(
      finding(
        'owner',
        `orchestrator: add to PROGRESS, under the next entry's "**Carried forward:**", the line "- ${text}" (it places ${sources.join(', ')})`,
        PROGRESS_PATH,
      ),
    );
  }
  return findings;
}
