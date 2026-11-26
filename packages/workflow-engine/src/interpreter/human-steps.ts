/**
 * What counts as a person taking part (plan C128.2, C140.2, F33), as data. `solely-automated` is
 * decided at run time from what happened, never from the shape of the graph: a wait resolved, not
 * timed out, by an event a user resolved singly, holding the decision's scope. A timeout, an API key,
 * a run, a bulk action, or a user who did not hold the scope is no person taking part.
 *
 * The rule for `case.resolved` is an inert entry here until Workflow 8B emits it. 8B adds entries by
 * passing rows to {@link createHumanStepTable}, and edits nothing in this file. What the entry cannot
 * say, whether the case holds the subject and whether the route read its resolution, the decision
 * record checks beside it (`conditionalsReading`).
 */
import { isJsonRecord, type JsonValue } from '../expressions/json.js';

export interface HumanStepEntry {
  /** `human-step.kind` on the decision record. */
  readonly kind: string;
  readonly event: string;
  readonly resolverType: string;
  readonly resolvedVia: string;
  /** The member of the wait's output that says the resolver held the decision's scope. */
  readonly heldScopeMember: string;
}

/** C128.2. */
export const HUMAN_STEP_ENTRIES: readonly HumanStepEntry[] = Object.freeze([
  {
    kind: 'case-resolution',
    event: 'case.resolved',
    resolverType: 'user',
    resolvedVia: 'single',
    heldScopeMember: 'resolver-held-inquiries-write',
  },
]);

export interface HumanStepTable {
  entryFor(event: string): HumanStepEntry | undefined;
  list(): readonly HumanStepEntry[];
}

/**
 * @throws {TypeError} for an event given twice: a bug in code, so it throws at start.
 */
export function createHumanStepTable(entries: readonly HumanStepEntry[]): HumanStepTable {
  const byEvent = new Map<string, HumanStepEntry>();
  for (const entry of entries) {
    if (byEvent.has(entry.event)) {
      throw new TypeError('An event has one human-step entry');
    }
    byEvent.set(entry.event, entry);
  }
  const listed = Object.freeze([...entries]);
  return Object.freeze({
    entryFor: (event: string) => byEvent.get(event),
    list: () => listed,
  });
}

/** C128.1: `human-step` on the decision record. */
export interface HumanStep {
  readonly kind: string;
  readonly 'actor-id': string;
  readonly 'event-id': string;
  readonly 'resolved-via': string;
}

/** C128.2: the human step a wait's output records, or `null` when no person took part. */
export function humanStepOf(table: HumanStepTable, waitOutput: JsonValue): HumanStep | null {
  if (!isJsonRecord(waitOutput) || waitOutput['resolved-by'] !== 'event') {
    return null;
  }
  const {
    'event-name': eventName,
    'event-id': eventId,
    'resolver-type': resolverType,
    'resolver-id': resolverId,
    'resolved-via': resolvedVia,
  } = waitOutput;
  const entry = typeof eventName === 'string' ? table.entryFor(eventName) : undefined;
  if (
    entry === undefined ||
    typeof eventId !== 'string' ||
    typeof resolverId !== 'string' ||
    resolverType !== entry.resolverType ||
    resolvedVia !== entry.resolvedVia ||
    waitOutput[entry.heldScopeMember] !== true
  ) {
    return null;
  }
  return {
    kind: entry.kind,
    'actor-id': resolverId,
    'event-id': eventId,
    'resolved-via': entry.resolvedVia,
  };
}
