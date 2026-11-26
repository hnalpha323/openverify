/**
 * C73.2, C75.3: the readable entry key and the evidence-hash input. `api-reports` takes the
 * HMAC-SHA-256 of {@link evidenceHashInput} under the environment's blind-index subkey (label
 * `openverify/report-match-evidence/v1`); the input is the canonical JSON array of the entry key,
 * the entry's content hash at match time (C77.3), the matched list name and the report's screened
 * query, whose object keys canonical JSON sorts, so the order is fixed and no two splits of name
 * and query give one input (P10). The risk-data hash never enters it (V06).
 */
import { canonicalJson } from '../record/index.js';

/** `<source>:<publisher id>`, the readable key of a list entry (C73.2). */
export function entryKey(sourceId: string, entryId: string): string {
  return `${sourceId}:${entryId}`;
}

export interface EvidenceInput {
  readonly entryKey: string;
  /** The entry's `contentHash` at match time. */
  readonly contentHash: string;
  /** The matched list name (an article's key for media). */
  readonly listName: string;
  /** The report's query as stored. */
  readonly query: Readonly<Record<string, unknown>>;
}

/** The canonical JSON the evidence HMAC is taken over. */
export function evidenceHashInput(input: EvidenceInput): string {
  return canonicalJson([input.entryKey, input.contentHash, input.listName, input.query]);
}
