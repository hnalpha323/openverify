/**
 * C253.2 (Workflow 11B, `dsar-export`): a listed file's live object, read when the files route
 * serves it (no file is copied into an export, so a redaction after the export reaches the file):
 *
 * - a verification file (`files`): redacted once its object was deleted (`deleted_at`) or its
 *   inquiry was redacted (which deletes the object, possibly not yet), as the console's file route
 *   reads it (C16);
 * - a transaction file (`transaction_files`, under the transaction the manifest names): redacted once
 *   its object was deleted, the file redacted, or its transaction redacted (C105.5);
 * - missing when no such file is in the environment.
 */
import {
  getFile,
  getInquiry,
  getTransaction,
  getTransactionFile,
  getVerification,
} from '@openverify/db';
import type { LiveFile, LiveFileReader } from './service.js';

const REDACTED: LiveFile = { state: 'redacted' };
const MISSING: LiveFile = { state: 'missing' };

/** The live object of a listed verification or transaction file. */
export const readLiveFile: LiveFileReader = async (db, environmentId, file) => {
  if (file.kind === 'verification-file') {
    const row = await getFile(db, environmentId, file.id);
    if (row === null) {
      return MISSING;
    }
    if (row.deletedAt !== null) {
      return REDACTED;
    }
    const verification = await getVerification(db, environmentId, row.verificationId);
    const inquiry =
      verification === null ? null : await getInquiry(db, environmentId, verification.inquiryId);
    if (inquiry?.redactedAt != null) {
      return REDACTED;
    }
    return {
      state: 'live',
      storageKey: row.storageKey,
      wrappedDek: row.wrappedDek,
      mediaType: row.mimeType,
    };
  }
  const transaction = await getTransaction(db, environmentId, file['belongs-to']);
  const row =
    transaction === null
      ? null
      : await getTransactionFile(db, environmentId, transaction.id, file.id);
  if (transaction === null || row === null) {
    return MISSING;
  }
  if (transaction.redactedAt !== null || row.deletedAt !== null || row.redactedAt !== null) {
    return REDACTED;
  }
  return {
    state: 'live',
    storageKey: row.storageKey,
    wrappedDek: row.wrappedDek,
    mediaType: row.mimeType,
  };
};
