/**
 * Owner decision 9 after 6B: the record members a match's sealed snapshot carries as evidence when
 * the entry has them, in the served entity's kebab-case names: an OFAC entry's lists other than
 * the SDN List (`list-memberships`), so a non-blocking listing is never shown as an SDN-level
 * block, and a PEP relative's class (`relative-of-class`). A record without them adds nothing, so
 * older snapshots and documents keep their shape.
 */
import type { WatchlistRecord } from '@openverify/watchlist';

/** What a snapshot's `entity` gains. */
export interface RecordEvidence {
  'list-memberships'?: { list: string; program: string | null }[];
  'relative-of-class'?: number;
}

/** The evidence members of `record`, each only when the record has it. */
export function recordEvidence(
  record: Pick<WatchlistRecord, 'list_memberships' | 'relative_of_class'>,
): RecordEvidence {
  const evidence: RecordEvidence = {};
  if (record.list_memberships !== undefined && record.list_memberships.length > 0) {
    evidence['list-memberships'] = record.list_memberships.map(({ list, program }) => ({
      list,
      program,
    }));
  }
  if (record.relative_of_class !== undefined) {
    evidence['relative-of-class'] = record.relative_of_class;
  }
  return evidence;
}

/**
 * What a sanctions entity (person, business, crypto address) takes: the entry's other lists. Its
 * strict schema has no PEP class, so a record that carried one could not be served.
 */
export function listEvidence(
  record: Pick<WatchlistRecord, 'list_memberships'>,
): Pick<RecordEvidence, 'list-memberships'> {
  const { 'list-memberships': memberships } = recordEvidence(record);
  return memberships === undefined ? {} : { 'list-memberships': memberships };
}

/** What a PEP relative's entity takes: the class of the PEP it relates to (a holder takes none). */
export function relativeEvidence(
  record: Pick<WatchlistRecord, 'relative_of_class'>,
): Pick<RecordEvidence, 'relative-of-class'> {
  const { 'relative-of-class': relativeOfClass } = recordEvidence(record);
  return relativeOfClass === undefined ? {} : { 'relative-of-class': relativeOfClass };
}
