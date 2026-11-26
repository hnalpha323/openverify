/**
 * The parity choices of plan C69.5 (H22): each item of the research gap table
 * (`docs/research/phase6-behaviour.md`, items G1-G13, M1-M7, V1-V6, T1-T10, X1-X5) and what
 * Phase 6 does about it. A test reads the gap table and requires every item exactly once.
 */

export interface ReportParityChoice {
  /** The gap-table ids this row covers, such as `G1` or `T9`. */
  readonly items: readonly string[];
  readonly publicBehaviour: string;
  readonly choice: string;
}

const row = (items: readonly string[], publicBehaviour: string, choice: string) =>
  Object.freeze({ items: Object.freeze([...items]), publicBehaviour, choice });

/** C69.5: the parity table. */
export const REPORT_PARITY: readonly ReportParityChoice[] = Object.freeze([
  row(
    ['G1', 'G2', 'G8', 'G9', 'G10', 'G13'],
    'report/<type> resources with rep_ ids, statuses, relationships, tags, history and report/<type>.<action> event names',
    'Matched; transaction served as null until Phase 7; submitted reserved (decision 3)',
  ),
  row(
    ['G3'],
    'No error codes documented on an errored report',
    'Ours: errors[] with codes (C69.3) and the report honesty rules (C69.4, ADR 0005)',
  ),
  row(
    ['G4'],
    'Templates without versions or an API',
    'Ours: versioned report templates and their API (decision 26)',
  ),
  row(
    ['G5'],
    'Create body with account-id, meta.auto-create-account* (default true) and processing-mode',
    'Matched (C72.1); the deprecated reference-id refused; inquiry-id ours',
  ),
  row(
    ['G6', 'G7', 'G12'],
    'Workflow-created reports, CSV bulk creation and PDF print',
    'Workflows in Phase 8, CSV and print in Phase 9; the inquiry-template report list is ours (C84)',
  ),
  row(
    ['G11'],
    'Redaction removes the PII; dismissal refused once redacted',
    'Matched (410 report_redacted); our report/<type>.redacted event',
  ),
  row(
    ['M1', 'M2', 'M3', 'M5'],
    'Recurrence every 1-365 days, run now, pause and resume, a 30-minute delay after the last dismissal',
    'Matched; pause and resume use reports:write',
  ),
  row(
    ['M4'],
    'The older report types stop recurring on a hit until it is dismissed',
    'Ours by default (monitoring continues); pause-on-match for parity (decision 5)',
  ),
  row(
    ['M6'],
    'Sources checked as often as every 10 minutes',
    'An operator-run sync or the 15-minute refresh tick (C76.2), with freshness and staleness (C76.3); the re-screen after a list update is ours (C74.4)',
  ),
  row(
    ['M7'],
    'is-continuous and is-recurring defined inconsistently',
    'Defined by us: more than one completed run; a next run scheduled and not paused (C70.2)',
  ),
  row(
    ['V1'],
    'Dismissal body under data.attributes',
    'Matched; entity-id on every type with review is ours',
  ),
  row(
    ['V2'],
    "A report's own ignore-list",
    'Matched; the suppression key (an evidence hash) is ours (C75.3)',
  ),
  row(
    ['V3', 'V4'],
    'Screening review with .reviewed; a notify-on-change record returns to pending when its data changes',
    'Matched in content for every type with review, the details in payload.meta (C70.4); "its data" defined: the matched identity or its risk data (programmes, listing date, PEP positions and relations; C75.8, V06)',
  ),
  row(
    ['V5'],
    'Two report permissions, read and write',
    'Split: reports:read, :write, :review, :redact and the report-template scopes (C72.2)',
  ),
  row(['V6'], 'No organisation-wide ignore list', 'None (decision 6)'),
  row(
    ['T1'],
    'Watchlist query and configuration',
    'Matched: address-country-code, presets as method sets (C79.1)',
  ),
  row(
    ['T2'],
    'matched-lists[] without a score',
    'Matched with flag-code, list-types[] and list-level match-types; score, levels and coverage are ours',
  ),
  row(
    ['T3'],
    'PEP classes, toggles and result shape',
    'Classes matched, heads of international organisations in class 2 (ours, C80.2); result[], positions[], associates[] and sources matched; topics, images and related-urls not served; candidates and portrait comparison not in Phase 6',
  ),
  row(
    ['T4'],
    'Media from a large article archive with entity resolution',
    'GDELT titles over 90 days in four lexicon languages, with a coverage notice (C81)',
  ),
  row(
    ['T5'],
    'Crypto addresses from one sanctions list, no dismissal',
    'OFAC and the UK list; dismissal ours',
  ),
  row(
    ['T6'],
    'Email signals, some deprecated fields null, age estimates',
    'R subset and adapters (C82.1); email-is-free-provider filled (informational, a divergence); age-estimated-* null (no documented method)',
  ),
  row(
    ['T7'],
    'Phone type, carrier, risk and SIM swap',
    'Numbering plan, the research rule and adapters (C82.2); phone-type null when the plan cannot tell',
  ),
  row(['T8'], 'Address lookup', 'R subset and the Smarty adapter (C82.3)'),
  row(
    ['T9'],
    'Business watchlist, default Strict',
    'Matched (strict, address-country-code); the warning and fitness-and-probity lists null (decision 18)',
  ),
  row(['T10'], 'The screening composite report', 'Later (C88)'),
  row(
    ['X1', 'X2', 'X3', 'X4', 'X5'],
    'Workflows, cases, dashboard, sandbox inputs and reusable data sharing',
    'Dashboard core matched (C86); synthetic sandbox values (decision 14); the rest later (C88)',
  ),
]);

/** Every gap-table id the table covers. */
export const REPORT_PARITY_ITEMS: readonly string[] = Object.freeze(
  REPORT_PARITY.flatMap((choice) => choice.items),
);
