/**
 * C77.3: the content hash and the risk-data hash of a record, frozen in Workflow 6A Stage 1a with
 * golden vectors. Both are SHA-256, in lower-case hex, of the canonical JSON of a versioned
 * projection: `["openverify/watchlist-content/v1", …]` and `["openverify/watchlist-risk/v1", …]`.
 *
 * - The content hash covers what matching reads: the kind, the names (full form, parts with their
 *   roles, script and quality), birth dates, countries, gender, identifiers and crypto addresses.
 *   A programme or remark edit leaves it alone, so it never lapses a dismissal (C75.3).
 * - The risk-data hash covers the programmes, `listed_at`, the PEP positions (position, class,
 *   country, start, end and whether in office, not their labels) and the relations, and, only when
 *   the record carries them, its OFAC list memberships and a relative's PEP class (owner decision
 *   9 after Workflow 6B). Notify-on-change compares it (C75.8, V06); it never enters the evidence
 *   hash.
 *
 * Remarks change neither hash, and the order of set-like lists changes neither.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, setLike } from './canonical.js';
import type { WatchlistRecord } from './schema.js';

const CONTENT_LABEL = 'openverify/watchlist-content/v1';
const RISK_LABEL = 'openverify/watchlist-risk/v1';

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** C77.3: the content hash of a record. */
export function contentHash(record: WatchlistRecord): string {
  return sha256Hex(
    canonicalJson([
      CONTENT_LABEL,
      {
        kind: record.kind,
        names: setLike(
          record.names.map((name) => ({
            full: name.full,
            parts: name.parts,
            script: name.script,
            quality: name.quality,
          })),
        ),
        birth_dates: setLike(record.birth_dates),
        countries: setLike(record.countries),
        gender: record.gender ?? null,
        identifiers: setLike(
          record.identifiers.map((identifier) => ({
            kind: identifier.kind,
            value: identifier.value,
            country: identifier.country ?? null,
          })),
        ),
        crypto_addresses: setLike(record.crypto_addresses),
      },
    ]),
  );
}

/** C77.3 (V06): the risk-data hash of a record. */
export function riskDataHash(record: WatchlistRecord): string {
  return sha256Hex(
    canonicalJson([
      RISK_LABEL,
      {
        programs: setLike(record.programs),
        listed_at: record.listed_at ?? null,
        positions: setLike(
          record.positions.map((position) => ({
            position: position.position,
            pep_class: position.pep_class,
            country: position.country,
            start: position.start,
            end: position.end,
            in_office: position.in_office,
          })),
        ),
        relations: setLike(
          record.relations.map((relation) => ({
            relation: relation.relation,
            entity_id: relation.entity_id,
          })),
        ),
        // Owner decision 9 after 6B: only when present (an `undefined` member is left out of the
        // canonical JSON), so a record without them keeps the hash it always had.
        list_memberships:
          record.list_memberships === undefined
            ? undefined
            : setLike(
                record.list_memberships.map((membership) => ({
                  list: membership.list,
                  program: membership.program,
                })),
              ),
        relative_of_class: record.relative_of_class,
      },
    ]),
  );
}
