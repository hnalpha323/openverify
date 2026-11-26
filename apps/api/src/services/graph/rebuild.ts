/**
 * C101.5 (Workflow 7B): `rebuildGraphIndexes`, which `blind-index:rebuild` calls after the
 * transaction field keys. After a key change every `graph_attributes` row made under another key id
 * is recomputed from its source's plaintext: an account's rows from its fields and reference id, an
 * inquiry's from what it holds (its fields, extraction, OTP destinations, its sessions' address
 * while retained, and its devices made under the current key). A row its source no longer gives is
 * gone: the source's rows are replaced, never patched, so a rotated device stays out (C94.4). It
 * lives in the API, as `rebuildListIndexes` does, because the key inputs are `packages/checks`' and
 * `packages/watchlist`'s. Counts only.
 *
 * Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signature.
 */
import {
  blindIndexKeyId,
  deleteGraphAttributesOfSource,
  deleteInquiryGraphAttributes,
  getAccount,
  getEnvironment,
  getInquiry,
  listGraphAttributesKeyedOtherwise,
  upsertGraphAttributes,
  type Db,
  type RebuildIndexesResult,
} from '@openverify/db';
import { accountGraphValues } from './collect.js';
import { graphAttributeRows, indexInquiryInTx } from './indexing.js';
import { graphSettingsOf, type GraphSettings } from './settings.js';

export interface RebuildGraphIndexesOptions {
  batchSize: number;
}

export type RebuildGraphIndexes = (
  db: Db,
  key: Uint8Array,
  options: RebuildGraphIndexesOptions,
) => Promise<RebuildIndexesResult>;

export const rebuildGraphIndexes: RebuildGraphIndexes = async (db, key, options) => {
  const keyId = blindIndexKeyId(key);
  const settingsOf = new Map<string, GraphSettings | null>();
  const settings = async (environmentId: string) => {
    if (!settingsOf.has(environmentId)) {
      const environment = await getEnvironment(db, environmentId);
      settingsOf.set(environmentId, environment === null ? null : graphSettingsOf(environment));
    }
    return settingsOf.get(environmentId) ?? null;
  };
  const result: RebuildIndexesResult = { scanned: 0, updated: 0 };
  for (;;) {
    const rows = await listGraphAttributesKeyedOtherwise(db, { keyId, limit: options.batchSize });
    if (rows.length === 0) {
      return result;
    }
    result.scanned += rows.length;
    // An account's own values, by holder and source (a consolidation's survivor holds the absorbed
    // account's), and each inquiry's whole.
    const accounts = new Map<string, { environmentId: string; holder: string; source: string }>();
    const inquiries = new Map<string, { environmentId: string; inquiryId: string }>();
    for (const row of rows) {
      if (row.sourceType === 'account') {
        accounts.set(`${row.environmentId}|${row.accountId}|${row.sourceId}`, {
          environmentId: row.environmentId,
          holder: row.accountId,
          source: row.sourceId,
        });
      } else if (row.inquiryId !== null) {
        inquiries.set(`${row.environmentId}|${row.inquiryId}`, {
          environmentId: row.environmentId,
          inquiryId: row.inquiryId,
        });
      }
    }
    const at = new Date();
    let removed = 0;
    for (const { environmentId, holder, source } of accounts.values()) {
      const environmentSettings = await settings(environmentId);
      result.updated += await db.transaction(async (tx) => {
        removed += await deleteGraphAttributesOfSource(tx, environmentId, {
          accountId: holder,
          sourceType: 'account',
          sourceId: source,
        });
        const account = await getAccount(tx, environmentId, source);
        if (account === null || environmentSettings?.indexing !== true) {
          return 0;
        }
        const values = accountGraphValues(key, environmentId, environmentSettings, account);
        return upsertGraphAttributes(tx, environmentId, graphAttributeRows(holder, values), at);
      });
    }
    for (const { environmentId, inquiryId } of inquiries.values()) {
      const environmentSettings = await settings(environmentId);
      result.updated += await db.transaction(async (tx) => {
        removed += await deleteInquiryGraphAttributes(tx, environmentId, inquiryId);
        const inquiry = await getInquiry(tx, environmentId, inquiryId);
        return inquiry === null || environmentSettings === null
          ? 0
          : indexInquiryInTx(tx, key, environmentSettings, inquiry, at);
      });
    }
    if (removed === 0) {
      // Nothing listed could be replaced: stop rather than read the same rows again.
      return result;
    }
  }
};
