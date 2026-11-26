/**
 * The ids of C16 redaction subjects that a stored copy mentions (Workflow 2B F005, F017).
 *
 * API logs and idempotent responses keep copies of request and response bodies. A copy can
 * hold a subject's PII without being "about" it: a list answer, an event read that embeds the
 * inquiry, a consolidation answer that includes another account. Redaction therefore cannot
 * rely on one `resource_id`. Every stored copy also records the ids of the redaction subjects
 * its text mentions, anywhere, and redaction clears the copies whose ids overlap the
 * redacted objects. A truncated body is scanned as stored, so an id cut off by truncation is
 * no longer in the copy either.
 */

/**
 * Prefixes of the objects C16 redaction clears copies of: inquiries, their verifications
 * and sessions, and accounts. Extend it when redaction covers a new kind of object.
 */
export const REDACTION_SUBJECT_ID_PREFIXES = Object.freeze([
  'inq',
  'ver',
  'iqse',
  'acc',
  // C40.1: selfie captures, whose events and API answers embed the subject.
  'self',
  // C73.5: reports, whose query, result and matches are the subject's.
  'rep',
  // C107.5 (Workflow 7A): a session's network evaluations, which hold its address and location,
  // and its devices, whose answers carry the fingerprints.
  'net',
  'dev',
  // C107.5 (Workflow 7B (L)): lists and every item kind, which hold third-party PII (C98.4), list
  // matches, which hold a subject's compared value, and importers.
  'lst',
  'libf',
  'lidf',
  'lic',
  'liea',
  'lifc',
  'ligl',
  'ligin',
  'liif',
  'liip',
  'lin',
  'lipn',
  'lisb',
  'lis',
  'lmt',
  'mprt',
  // C143.5 (Workflow 8A (A)): a decision's id, because its comment is forgotten with its subject.
  'idec',
  // C107.5 (Workflow 7B (T)): a transaction, and its files and labels, which carry its data. Types
  // and versions are configuration, not a subject.
  'txn',
  'txnf',
  'txnl',
  // C102.7, C107.5 (Workflow 7B (G)): a graph query, whose params name the people searched for and
  // whose result names accounts. Templates and versions are configuration, not a subject.
  'grphq',
  // C120.9, C143.5 (Workflow 8A): a run, whose values name its subjects. Versions and definitions are
  // configuration, not a subject.
  'wfr',
  // C139.1, C143.5 (Workflow 8B (C)): a case, whose fields name its subject, and a comment, whose
  // message can. Templates and versions are configuration, not a subject.
  'case',
  'cscm',
  // C139.1, C143.5 (Workflow 8B (F)): an attachment, whose object and name are a subject's data.
  'catt',
] as const);

/** A C1 id with one of the prefixes: the prefix, `_`, then a 26-character ULID. */
const SUBJECT_ID = new RegExp(
  `\\b(?:${REDACTION_SUBJECT_ID_PREFIXES.join('|')})_[0-7][0-9A-HJKMNP-TV-Z]{25}\\b`,
  'g',
);

/** The text of a stored value: strings as they are, anything else as JSON. */
function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  // `undefined` for a function or symbol, whatever the lib typing says.
  const json = JSON.stringify(value) as string | undefined;
  return json ?? '';
}

/** The distinct redaction subject ids that any of `values` mentions, sorted. */
export function subjectIdsIn(...values: unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    for (const match of textOf(value).matchAll(SUBJECT_ID)) {
      ids.add(match[0]);
    }
  }
  return [...ids].sort();
}
