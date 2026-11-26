/**
 * C168.6, C174.5 (Phase 9, Workflow 9B; review P23): `rebuildAuditLogIpIndex`, which
 * `blind-index:rebuild` (`scripts/blind-index-rebuild.ts`) calls after the case field keys. Owner:
 * `api-access`; `foundation-9b` (Stage 1b (U)) froze the signature and placed the call.
 *
 * It backfills and rewrites `audit_log_ip_index` from each audit entry's encrypted address, as
 * `identifierKey(key, { environmentId, kind: 'audit-ip', input })` under the label
 * `openverify/audit-ip/v1` (`AUDIT_IP_INDEX_LABEL`), in batches of `batchSize`, never updating
 * `audit_logs` itself, so a key change does not leave `filter[ip]` answering nothing. Counts only;
 * it logs nothing.
 */
import { indexAuditLogAddresses, type Db, type RebuildIndexesResult } from '@openverify/db';

export interface RebuildAuditLogIpIndexOptions {
  batchSize: number;
}

export type RebuildAuditLogIpIndex = (
  db: Db,
  key: Uint8Array,
  options: RebuildAuditLogIpIndexOptions,
) => Promise<RebuildIndexesResult>;

export const rebuildAuditLogIpIndex: RebuildAuditLogIpIndex = async (db, key, { batchSize }) => {
  let scanned = 0;
  let updated = 0;
  let afterId: number | null = 0;
  while (afterId !== null) {
    const batch = await indexAuditLogAddresses(db, key, { afterId, limit: batchSize });
    scanned += batch.scanned;
    updated += batch.updated;
    afterId = batch.lastId;
  }
  return { scanned, updated };
};
