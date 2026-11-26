/**
 * What `docs/PROGRESS.md` records for C284.2 (docs-release): the owner items' states (Q1-Q12 in
 * Phase 11's row of the phase table and any later `**Qn:**` line; Phase 10's P1-P5 in Phase 10's
 * row, never Phase 9's P1-P9 handover items), the regions where a Workflow carries its open items
 * (every carry form PROGRESS uses, 11E decisions item 21), and the Phase 11 Workflow entries.
 */

export const PROGRESS_PATH = 'docs/PROGRESS.md';
export const PLAN_MASTER_PATH = 'docs/PLAN.md';

/** The owner items whose state PROGRESS must record (C284.2). */
export const OWNER_ITEMS = [
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'Q6',
  'Q7',
  'Q8',
  'Q9',
  'Q10',
  'Q11',
  'Q12',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
] as const;
export type OwnerItem = (typeof OWNER_ITEMS)[number];

export type OwnerState = 'pending' | 'granted' | 'declined';

export interface RecordedState {
  readonly state: OwnerState;
  /** `granted narrowly`, `declined`, `pending`, as PROGRESS words it. */
  readonly words: string;
  readonly line: number;
}

const STATE_WORDS: readonly [string, OwnerState][] = [
  ['granted narrowly', 'granted'],
  ['granted', 'granted'],
  ['declined', 'declined'],
  ['pending', 'pending'],
];

/** The range and single-id patterns per letter (constants only; C252). */
const ID_PATTERNS = {
  P: { range: /\bP(\d+)\s?[\u2013-]\s?P(\d+)\b/g, single: /\bP(\d+)\b/g },
  Q: { range: /\bQ(\d+)\s?[\u2013-]\s?Q(\d+)\b/g, single: /\bQ(\d+)\b/g },
} as const;

/** The ids a clause names: `P1 and P2`, `Q1–Q12`, `P4`. */
function idsOf(clause: string, letter: 'P' | 'Q'): readonly string[] {
  const ids: string[] = [];
  let rest = clause;
  for (const match of clause.matchAll(ID_PATTERNS[letter].range)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    for (let n = from; n <= to; n += 1) {
      ids.push(`${letter}${String(n)}`);
    }
    rest = rest.replace(match[0], ' ');
  }
  for (const match of rest.matchAll(ID_PATTERNS[letter].single)) {
    ids.push(`${letter}${match[1] ?? ''}`);
  }
  return ids;
}

/** The first state word in `clause` after its last id, if any. */
function stateOf(clause: string): { state: OwnerState; words: string } | null {
  const lower = clause.toLowerCase();
  let best: { index: number; state: OwnerState; words: string } | null = null;
  for (const [words, state] of STATE_WORDS) {
    const index = lower.indexOf(words);
    if (index >= 0 && (best === null || index < best.index)) {
      best = { index, state, words };
    }
  }
  return best === null ? null : { state: best.state, words: best.words };
}

/** The clauses of a phase-table row or a line, cut at `,`, `;`, `(` and `)`. */
const clausesOf = (text: string): readonly string[] => text.split(/[,;()]/);

/**
 * The owner items' states as PROGRESS records them. Phase 10's row gives P1-P5 and Phase 11's
 * row gives Q1-Q12; a later `**Qn:** <state>` line (the newest entry first) overrides a Q.
 */
export function ownerStates(progressText: string): ReadonlyMap<OwnerItem, RecordedState> {
  const states = new Map<OwnerItem, RecordedState>();
  const lines = progressText.split('\n');
  const record = (ids: readonly string[], text: string, line: number, override: boolean): void => {
    const found = stateOf(text);
    if (found === null) {
      return;
    }
    for (const id of ids) {
      if (
        (OWNER_ITEMS as readonly string[]).includes(id) &&
        (override || !states.has(id as OwnerItem))
      ) {
        states.set(id as OwnerItem, { ...found, line });
      }
    }
  };
  // `**Q12:** pending; ...`: the newest entry is first, so the first such line wins.
  const explicit = new Map<string, { text: string; line: number }>();
  lines.forEach((text, index) => {
    const match = /^\*\*(Q\d+):\*\*\s*(.*)$/.exec(text);
    if (match?.[1] !== undefined && !explicit.has(match[1])) {
      explicit.set(match[1], { text: match[2] ?? '', line: index + 1 });
    }
  });
  lines.forEach((text, index) => {
    const row = /^\|\s*(10|11)\s*\|/.exec(text);
    if (row === null) {
      return;
    }
    const letter = row[1] === '10' ? 'P' : 'Q';
    for (const clause of clausesOf(text)) {
      record(idsOf(clause, letter), clause, index + 1, false);
    }
  });
  for (const [id, { text, line }] of explicit) {
    record([id], text.split(/[;.]/)[0] ?? '', line, true);
  }
  return states;
}

/** A region of PROGRESS that carries open items, with the line it starts on. */
export interface CarryRegion {
  readonly line: number;
  readonly form: string;
  readonly text: string;
}

/** The carry forms PROGRESS uses (11E decisions item 21; contracts-11e amendment 2(d)). */
const CARRY_FORMS: readonly [RegExp, string][] = [
  [/^\*\*Carried forward:\*\*/, 'Carried forward:'],
  [/^\*\*Carried forward\*\* \(beyond 6B\):/, 'Carried forward (beyond 6B):'],
  [/^\*\*Carried forward\*\*\s*$/, 'Carried forward'],
  [/^\*\*Known items\.\*\*/, 'Known items.'],
  [/^\*\*Open, with owners\*\*/, 'Open, with owners'],
  [/^- \*\*Deferred:\*\*/, 'Deferred:'],
  [/^- \*\*Carried out of 11A\*\*/, 'Carried out of 11A'],
];

/** Every carry region of PROGRESS: from its label to the next heading or bold label. */
export function carryRegions(progressText: string): readonly CarryRegion[] {
  const lines = progressText.split('\n');
  const regions: CarryRegion[] = [];
  lines.forEach((text, index) => {
    const form = CARRY_FORMS.find(([pattern]) => pattern.test(text));
    if (form === undefined) {
      return;
    }
    const body = [text];
    for (const next of lines.slice(index + 1)) {
      if (next.startsWith('#') || next.startsWith('**') || next.startsWith('- **')) {
        break;
      }
      body.push(next);
    }
    regions.push({ line: index + 1, form: form[1], text: body.join('\n') });
  });
  return regions;
}

/** The text of every Phase 11 Workflow entry (`## <date>: Phase 11, Workflow 11X done (...)`). */
export function phase11Entries(progressText: string): readonly { line: number; text: string }[] {
  const lines = progressText.split('\n');
  const entries: { line: number; text: string }[] = [];
  lines.forEach((text, index) => {
    if (!/^## \d{4}-\d{2}-\d{2}: Phase 11, Workflow 11[A-G] done/.test(text)) {
      return;
    }
    const body = [text];
    for (const next of lines.slice(index + 1)) {
      if (next.startsWith('## ')) {
        break;
      }
      body.push(next);
    }
    entries.push({ line: index + 1, text: body.join('\n') });
  });
  return entries;
}

/** The bodies of PLAN's `### Next release...` sections, headings included. */
export function nextReleaseSections(planText: string): readonly string[] {
  const lines = planText.split('\n');
  const sections: string[] = [];
  lines.forEach((text, index) => {
    if (!text.startsWith('### Next release')) {
      return;
    }
    const body = [text];
    for (const next of lines.slice(index + 1)) {
      if (/^#{1,3} /.test(next)) {
        break;
      }
      body.push(next);
    }
    sections.push(body.join('\n'));
  });
  return sections;
}

/** The "Owner items (defaults taken; nothing blocks)" lists of earlier phases, item by item (bulleted or numbered). */
export function defaultsTaken(progressText: string): readonly { line: number; text: string }[] {
  const lines = progressText.split('\n');
  const items: { line: number; text: string }[] = [];
  lines.forEach((text, index) => {
    if (!text.startsWith('**Owner items (defaults taken; nothing blocks)')) {
      return;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? '';
      if (line.startsWith('#') || line.startsWith('**')) {
        break;
      }
      const item = /^(?:- |\d+\. )(.+)$/.exec(line);
      if (item?.[1] !== undefined) {
        items.push({ line: next + 1, text: item[1].trim() });
      }
    }
  });
  return items;
}
