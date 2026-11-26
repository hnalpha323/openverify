/**
 * C78.3: what candidate retrieval is given (`retrieveCandidates`): the subject's query keys, which
 * it filters by the entries holding them (owner decision 1 after 6B); the reach of every pair of
 * the subject's tokens, so a search that cannot reach them says so; its identifiers for the exact
 * `(kind, value_normalised)` path; its normalised names for the `pg_trgm` path and the weak-alias
 * equality; and the canonical crypto address.
 */
import { queryNameKeys, queryNameReach, type VariantGroups } from '../keys/index.js';
import type { ScreeningSubject } from './subject.js';

export interface RetrievalQuery {
  readonly keys: readonly string[];
  readonly identifiers: readonly { readonly kind: string; readonly value: string }[];
  /** Each subject name's `normalised` form (C78.1), deduplicated. */
  readonly normalisedNames: readonly string[];
  /** Owner decision 1 after 6B: the key groups of `queryNameReach`, one per pair of keyed tokens. */
  readonly reach: readonly (readonly string[])[];
}

/** The retrieval inputs of a subject. */
export function retrievalQuery(subject: ScreeningSubject, groups: VariantGroups): RetrievalQuery {
  return {
    keys: queryNameKeys(subject.names, groups),
    identifiers: subject.identifiers.map(({ kind, value }) => ({ kind, value })),
    normalisedNames: [...new Set(subject.names.map((name) => name.normalised))],
    reach: queryNameReach(subject.names, groups),
  };
}
