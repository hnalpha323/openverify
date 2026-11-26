/**
 * C284.1: `docs/release/checklist.md` and its parser (docs-release). The checklist holds every line
 * of the plan's "Release checklist" (both lists, ids `B01`... and `O01`...) and the lines the Phase
 * 7-11 records add, each with its state, who moves it, its evidence and its date. The states are
 * set from the evidence that exists at the checklist's date, never from a target.
 */
import type { CheckFinding, Repository } from '../types.js';
import { REQUIRED_KNOWN_ITEMS } from './known-items.js';
import { backticked, tablesOf } from './markdown.js';

export const CHECKLIST_PATH = 'docs/release/checklist.md';
export const PLAN_PATH = 'docs/plans/phase-11.plan.md';

/** C284.1's states, plus `ci-pending` for a line that waits only on a CI run (rule 25, KP10-59). */
export const CHECKLIST_STATES = ['done', 'open', 'owner', 'ci-pending'] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];

/** The header every checklist table carries. */
export const CHECKLIST_HEADER = ['Id', 'Line', 'State', 'Who', 'Evidence', 'Date'] as const;

/** The sentence the checklist's preamble carries (the plan's no-iOS preamble; review H26). */
export const NO_IOS_SENTENCE = 'No iOS code, app or artifact ships in this release';

/** The values the `Shipped flow image` fact may take (C289's Phase 10 P2 row). */
export const FLOW_IMAGES = ['guidance', 'noguidance'] as const;

export interface ChecklistLine {
  readonly id: string;
  readonly section: string;
  readonly text: string;
  readonly state: ChecklistState;
  readonly who: string;
  readonly evidence: string;
  /** The repository paths the evidence cites (backticked, `:line` and `#anchor` removed). */
  readonly evidencePaths: readonly string[];
  readonly date: string;
  readonly line: number;
}

/** The facts the checklist states above its tables (`- <Key>: \`<value>\``). */
export interface ChecklistFacts {
  readonly asOf: string | null;
  readonly releaseVersion: string | null;
  readonly shippedFlowImage: string | null;
}

export interface Checklist {
  readonly facts: ChecklistFacts;
  readonly lines: readonly ChecklistLine[];
  /** Rows that do not parse: a bad state, date or id, a duplicate id, a wrong cell count. */
  readonly problems: readonly { readonly line: number; readonly message: string }[];
}

/** One line of the plan's "Release checklist", in its list (`built` or `owner`). */
export interface PlanChecklistLine {
  readonly list: 'built' | 'owner';
  readonly text: string;
}

const ID = /^[A-Z0-9][A-Za-z0-9./-]*$/;
const ID_SEPARATORS = /[-./]{2}|[-./]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROOT_FILE = /^[\w.-]+\.(?:md|csv|txt|json|ya?ml|ts|kts|properties|toml|py|sh)$/;
const FACT = /^- (As of|Release version|Shipped flow image): `([^`]+)`/;

const isState = (value: string): value is ChecklistState =>
  (CHECKLIST_STATES as readonly string[]).includes(value);

/** The repository paths among an evidence cell's backticked spans. */
export function evidencePathsOf(evidence: string): readonly string[] {
  return backticked(evidence)
    .map((span) => span.replace(/#.*$/, '').replace(/:[\d-]+$/, ''))
    .filter((span) => !/\s/.test(span) && !span.endsWith('/'))
    .filter((span) => (span.includes('/') && /\.[A-Za-z0-9]+$/.test(span)) || ROOT_FILE.test(span));
}

export function parseChecklist(text: string): Checklist {
  const facts: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = FACT.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      facts[match[1]] = match[2];
    }
  }
  const lines: ChecklistLine[] = [];
  const problems: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  const header = CHECKLIST_HEADER.join('|');
  for (const table of tablesOf(text)) {
    if (table.header.join('|') !== header) {
      continue;
    }
    for (const row of table.rows) {
      if (row.cells.length !== CHECKLIST_HEADER.length) {
        problems.push({
          line: row.line,
          message: `row has ${String(row.cells.length)} cells, not ${String(CHECKLIST_HEADER.length)}`,
        });
        continue;
      }
      const [id = '', lineText = '', state = '', who = '', evidence = '', date = ''] = row.cells;
      const before = problems.length;
      if (!ID.test(id) || ID_SEPARATORS.test(id)) {
        problems.push({ line: row.line, message: `${id}: id is not a checklist id` });
      }
      if (!isState(state)) {
        problems.push({
          line: row.line,
          message: `${id}: state "${state}" is not one of ${CHECKLIST_STATES.join(', ')}`,
        });
      }
      if (!DATE.test(date)) {
        problems.push({ line: row.line, message: `${id}: date "${date}" is not YYYY-MM-DD` });
      }
      if (seen.has(id)) {
        problems.push({ line: row.line, message: `${id}: duplicate id` });
      }
      seen.add(id);
      if (problems.length === before && isState(state)) {
        lines.push({
          id,
          section: table.section,
          text: lineText,
          state,
          who,
          evidence,
          evidencePaths: evidencePathsOf(evidence),
          date,
          line: row.line,
        });
      }
    }
  }
  return {
    facts: {
      asOf: facts['As of'] ?? null,
      releaseVersion: facts['Release version'] ?? null,
      shippedFlowImage: facts['Shipped flow image'] ?? null,
    },
    lines,
    problems,
  };
}

/** The plan's "Release checklist" lines, both lists, in order. */
export function planChecklistLines(planText: string): readonly PlanChecklistLine[] {
  const lines = planText.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## Release checklist'));
  if (start < 0) {
    return [];
  }
  const found: PlanChecklistLine[] = [];
  let list: 'built' | 'owner' | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) {
      break;
    }
    if (line.startsWith('**Built and green')) {
      list = 'built';
    } else if (line.startsWith('**Owner steps')) {
      list = 'owner';
    } else if (list !== null && line.startsWith('- [ ] ')) {
      found.push({ list, text: line.slice('- [ ] '.length).trim() });
    }
  }
  return found;
}

/** The ids the checklist gives the plan's lines: `B01`... for the first list, `O01`... for the second. */
export function planLineId(list: 'built' | 'owner', index: number): string {
  return `${list === 'built' ? 'B' : 'O'}${String(index + 1).padStart(2, '0')}`;
}

function error(rule: string, message: string, line?: number): CheckFinding {
  return {
    rule,
    path: CHECKLIST_PATH,
    ...(line === undefined ? {} : { line }),
    message,
    severity: 'error',
  };
}

/** The checklist's record findings against the plan and the ids in `required`. */
export function checklistFindings(
  repo: Repository,
  required: readonly string[],
): readonly CheckFinding[] {
  if (!repo.exists(CHECKLIST_PATH)) {
    return [error('checklist-missing', 'docs/release/checklist.md does not exist (C284.1)')];
  }
  const text = repo.readText(CHECKLIST_PATH);
  const checklist = parseChecklist(text);
  const findings: CheckFinding[] = [];
  if (!text.includes(NO_IOS_SENTENCE)) {
    findings.push(error('checklist-ios', `the preamble does not say "${NO_IOS_SENTENCE}"`));
  }
  const { asOf, releaseVersion, shippedFlowImage } = checklist.facts;
  if (asOf === null || !DATE.test(asOf)) {
    findings.push(error('checklist-facts', 'no "- As of: `YYYY-MM-DD`" fact'));
  }
  if (releaseVersion === null || !/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
    findings.push(error('checklist-facts', 'no "- Release version: `x.y.z`" fact'));
  }
  if (shippedFlowImage === null || !(FLOW_IMAGES as readonly string[]).includes(shippedFlowImage)) {
    findings.push(
      error('checklist-facts', `no "- Shipped flow image: \`${FLOW_IMAGES.join('` or `')}\`" fact`),
    );
  }
  for (const problem of checklist.problems) {
    findings.push(error('checklist-row', problem.message, problem.line));
  }
  const byId = new Map(checklist.lines.map((line) => [line.id, line]));
  const counters = { built: 0, owner: 0 };
  for (const planLine of planChecklistLines(repo.readText(PLAN_PATH))) {
    const id = planLineId(planLine.list, counters[planLine.list]);
    counters[planLine.list] += 1;
    const line = byId.get(id);
    if (line === undefined) {
      findings.push(error('checklist-plan-line', `${id} is missing: "${planLine.text}"`));
    } else if (line.text !== planLine.text) {
      findings.push(
        error(
          'checklist-plan-line',
          `${id} does not hold the plan’s line: "${planLine.text}"`,
          line.line,
        ),
      );
    }
  }
  for (const id of required) {
    if (!byId.has(id)) {
      findings.push(
        error(
          'checklist-known-item',
          `${id} has no line (KP11-50: every deferred known item by id)`,
        ),
      );
    }
  }
  for (const line of checklist.lines) {
    if (line.state === 'done' && line.evidencePaths.length === 0) {
      findings.push(
        error('checklist-evidence', `${line.id} is done but cites no evidence path`, line.line),
      );
    }
    for (const cited of line.evidencePaths) {
      if (!repo.exists(cited)) {
        findings.push(
          error('checklist-evidence', `${line.id} cites ${cited}, which does not exist`, line.line),
        );
      }
    }
  }
  return findings;
}

/** C284.1 as a record test: the checklist parses, holds every plan line and every required id. */
export function checkChecklist(repo: Repository): readonly CheckFinding[] {
  return checklistFindings(
    repo,
    REQUIRED_KNOWN_ITEMS.map((item) => item.id),
  );
}
