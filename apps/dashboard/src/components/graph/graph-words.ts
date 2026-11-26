/**
 * The graph in words (C108): kind labels and node styles, query statuses, problem codes, bulk
 * actions and their outcomes, and what the caps and the index cut from a result. Nothing here
 * passes, fails or declines anyone: a link is a lead for a reviewer (C102, ADR 0006).
 *
 * Every node type has its own shape as well as its own colour, and every colour holds 3:1 against
 * the canvas (WCAG 1.4.1, 1.4.11); the table view names the kind in words.
 */
import {
  GRAPH_PROBLEM_CODES,
  type GraphKind,
  type GraphProblemCode,
  type GraphTemplateProblemCode,
} from '@openverify/contracts';
import type { GraphBulkAction, GraphBulkOutcome, GraphQueryStatus } from '@openverify/core';
import type { DisplayProblem } from '../../lib/action-state';

export type GraphNodeType = 'account' | GraphKind;

export interface GraphNodeStyle {
  /** A Cytoscape node shape. */
  readonly shape: string;
  /** The shape in words, for the legend. */
  readonly shapeName: string;
  /** A hex colour, at least 3:1 against white. */
  readonly colour: string;
}

/** What `truncationSentences` reads from a result. */
export interface TruncationFacts {
  readonly 'node-limit-reached': boolean;
  readonly 'skipped-hub-values': number;
  readonly 'index-complete': boolean;
  readonly 'kinds-not-indexed': readonly GraphKind[];
  /** The pinned version's node limit, when it was read. */
  readonly nodeLimit: number | null;
}

const LABELS: Readonly<Record<GraphNodeType, string>> = Object.freeze({
  account: 'Account',
  government_id_number: 'Government ID number',
  chip_signature: 'Chip signature',
  crypto_address: 'Crypto address',
  email_address: 'Email address (confirmed)',
  phone_number: 'Phone number (confirmed)',
  email_address_unconfirmed: 'Email address (unconfirmed)',
  phone_number_unconfirmed: 'Phone number (unconfirmed)',
  reference_id: 'Reference ID',
  name_birthdate: 'Name and birthdate',
  address: 'Address',
  device_fingerprint: 'Device fingerprint (Android ID)',
  device_class: 'Device class',
  browser_fingerprint: 'Browser fingerprint',
  ip_address: 'IP address',
  name: 'Name',
  birthdate: 'Birthdate',
  postal_code: 'Postal code',
  email_domain: 'Email domain',
});

const style = (shape: string, shapeName: string, colour: string): GraphNodeStyle =>
  Object.freeze({ shape, shapeName, colour });

export const GRAPH_NODE_STYLES: Readonly<Record<GraphNodeType, GraphNodeStyle>> = Object.freeze({
  account: style('ellipse', 'circle', '#1d4ed8'),
  government_id_number: style('rectangle', 'square', '#b91c1c'),
  chip_signature: style('round-rectangle', 'rounded square', '#9a3412'),
  crypto_address: style('cut-rectangle', 'cut square', '#a16207'),
  email_address: style('diamond', 'diamond', '#047857'),
  phone_number: style('triangle', 'triangle', '#0f766e'),
  email_address_unconfirmed: style('round-diamond', 'rounded diamond', '#15803d'),
  phone_number_unconfirmed: style('round-triangle', 'rounded triangle', '#0e7490'),
  reference_id: style('star', 'star', '#6d28d9'),
  name_birthdate: style('hexagon', 'hexagon', '#a21caf'),
  address: style('pentagon', 'pentagon', '#be185d'),
  device_fingerprint: style('octagon', 'octagon', '#4338ca'),
  device_class: style('round-octagon', 'rounded octagon', '#475569'),
  browser_fingerprint: style('heptagon', 'heptagon', '#7c3aed'),
  ip_address: style('vee', 'chevron', '#c2410c'),
  name: style('barrel', 'barrel', '#be123c'),
  birthdate: style('tag', 'tag', '#57534e'),
  postal_code: style('rhomboid', 'parallelogram', '#3f6212'),
  email_domain: style('concave-hexagon', 'concave hexagon', '#0369a1'),
});

/** A node type's name, as the table and the legend say it. */
export function graphKindLabel(type: GraphNodeType): string {
  return LABELS[type];
}

/** The label inside a sentence: lower-cased unless it starts with an acronym (`IP address`). */
export function graphKindInSentence(type: GraphNodeType): string {
  const label = LABELS[type];
  return /^[A-Z]{2}/.test(label) ? label : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** "a", "a and b", "a, b and c". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) {
    return words.join('');
  }
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

export const GRAPH_STATUS_WORDS: Readonly<
  Record<GraphQueryStatus, { readonly label: string; readonly description: string }>
> = Object.freeze({
  submitted: {
    label: 'Submitted',
    description:
      'Waiting to run, or running. This page does not refresh by itself: reload it to see the result.',
  },
  completed: { label: 'Completed', description: 'The search finished within its limits.' },
  errored: { label: 'Errored', description: 'The search could not run, so it has no result.' },
  cancelled: { label: 'Cancelled', description: 'The query was cancelled before it ran.' },
  timed_out: {
    label: 'Timed out',
    description: 'The search passed its deadline: it shows what it gathered until then.',
  },
});

export const GRAPH_PROBLEM_WORDS: Readonly<Record<GraphProblemCode, string>> = Object.freeze({
  weak_kind_not_allowed:
    'A weak kind needs include-weak-kinds set to true, and then at most 4 hops.',
  graph_parameter_unbound: 'A {{parameter}} in the template is not declared among its parameters.',
  graph_parameter_missing: 'A parameter the template uses was not given a value.',
  graph_parameter_not_allowed:
    'A parameter of a kind that identifies a person needs the pii:view permission as well.',
  graph_template_archived: 'The template is archived, so it cannot change or run.',
  graph_template_not_published: 'The template has no published version to run.',
  graph_template_version_not_draft:
    'Only a draft can change or be published, and this version is no longer a draft.',
  graph_query_not_cancellable: 'Only a submitted query can be cancelled: this one has ended.',
  graph_query_redacted: 'This query was redacted, so its result and its values are gone.',
  graph_sync_limited: 'Two queries already run at once in this environment. Try again in a moment.',
  graph_node_not_found: 'That node is not in this result.',
  selection_too_large:
    'The result holds more than 500 accounts: select at most 500 of them instead of all.',
  biometric_list_not_bulk:
    'Face and background lists are never filled in bulk: their items come one consenting inquiry at a time.',
});

export const GRAPH_OUTCOME_WORDS: Readonly<Record<GraphBulkOutcome, string>> = Object.freeze({
  done: 'Done',
  skipped_redacted: 'Skipped: the account was redacted',
  skipped_consolidated: 'Skipped: the account was merged into another',
  refused_scope: 'Refused: your role lacks this action’s permission',
});

export const GRAPH_ACTION_WORDS: Readonly<Record<GraphBulkAction, string>> = Object.freeze({
  'add-tag': 'Add a tag',
  'remove-tag': 'Remove a tag',
  'set-account-status': 'Set the account status',
  'add-to-list': 'Add values to a list',
  export: 'Export as CSV',
  'create-case': 'Create a case',
});

const CODES: ReadonlySet<string> = new Set(GRAPH_PROBLEM_CODES);

const RATE_LIMITED =
  'Too many graph requests: an environment runs at most 30 queries a minute, and each person unmasks at most 60 values a minute. Try again shortly.';

/**
 * `problem`, titled in words when its `code` is a graph problem's, or when it is a rate limit with
 * no code; anything else (a plain 422 with its pointer) unchanged.
 */
export function describeGraphProblem(problem: DisplayProblem): DisplayProblem {
  if (problem.code !== undefined && CODES.has(problem.code)) {
    return { ...problem, title: GRAPH_PROBLEM_WORDS[problem.code as GraphProblemCode] };
  }
  if (problem.status === 429) {
    return { ...problem, title: RATE_LIMITED };
  }
  return problem;
}

/** A publish refusal of `graphTemplateConfigProblems`, in words. */
export function graphTemplateProblemWords(code: GraphTemplateProblemCode): string {
  return GRAPH_PROBLEM_WORDS[code];
}

/** What the index lacked and what the caps cut, one sentence each; none for a whole result. */
export function truncationSentences(facts: TruncationFacts): string[] {
  const sentences: string[] = [];
  const missing = facts['kinds-not-indexed'];
  if (!facts['index-complete'] || missing.length > 0) {
    const one = missing.length === 1;
    sentences.push(
      missing.length === 0
        ? 'The index is still being built, so links may be missing.'
        : `The index is still being built: ${joinWords(missing.map(graphKindInSentence))} ${one ? 'is' : 'are'} not indexed for this query, so links through ${one ? 'it' : 'them'} may be missing.`,
    );
  }
  if (facts['node-limit-reached']) {
    sentences.push(
      facts.nodeLimit === null
        ? 'The search stopped at its node limit: more may be linked beyond what is shown.'
        : `The search stopped at the node limit (${String(facts.nodeLimit)} nodes): more may be linked beyond what is shown.`,
    );
  }
  const hubs = facts['skipped-hub-values'];
  if (hubs > 0) {
    sentences.push(
      hubs === 1
        ? '1 shared value was skipped because more than the fan-out cap of accounts hold it.'
        : `${String(hubs)} shared values were skipped because more than the fan-out cap of accounts hold each one.`,
    );
  }
  return sentences;
}
