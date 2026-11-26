/**
 * C253.1, C253.2, C253.5, C253.7 (Workflow 11B, `dsar-export`): the access export's routes, ours.
 * The route has already checked `account-access:export` (Stage 1a amendment 35); every service
 * function here checks the rest of C253.1 again, so no route can forget it:
 *
 * - **Who:** an API key, or a user who holds `pii:view` (C15) and passed Phase 9's step-up within
 *   `STEP_UP_WINDOW_SECONDS` (`mfa_verified_at`; an SSO session's re-authentication sets it too,
 *   C248.6), 403 `step_up_required` otherwise (review P16). A key minted without `pii:view` sees PII
 *   masked, so it is refused as a user without it is (403 naming `pii:view`).
 * - **Create** (`POST /accounts/:id/export`, 202): the account in the caller's environment (else the
 *   generic 404); 422 `account_export_too_large` with the counts when the account lists more than
 *   `ACCOUNT_EXPORT_LIMITS.items` items now (C253.5); under the account's row lock, 409
 *   `account_export_pending` while it has one `pending` export, else a `pending` row and one audit
 *   entry (`account-export.created`, ids only). The `account-export` job is admitted after the
 *   commit under C251's cap (`quotas`' admission); a held export stays `pending`.
 * - **Read** (`GET /account-exports/:id`): the export of the caller's environment, else the generic
 *   404; a `ready` export past its `expires-at` reads `expired` before the retention pass marks it.
 * - **Manifest** and **files**: only a `ready` export within its life serves them (the generic 404
 *   otherwise); each read is audited with ids only, never content (rule 11). A file the manifest
 *   does not list is the generic 404; a listed file whose live object was redacted is 410
 *   `account_export_item_redacted` (C253.2: no file is copied).
 *
 * The store is a port (`AccountExportStore`), which `packages/db/src/repositories/account-exports.ts`
 * implements over `account_exports`.
 */
import {
  ACCOUNT_EXPORT_LIMITS,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
  STEP_UP_WINDOW_SECONDS,
  accountExportManifestSchema,
  type AccountExportManifest,
  type AccountExportResource,
} from '@openverify/contracts';
import { decryptBytes, getUserSession, type Db, type Keyring } from '@openverify/db';
import { canViewPii } from '../../auth/pii.js';
import { NotFoundError, PermissionDeniedError } from '../../errors.js';
import type { AuditLogger, Clock, FileStorage, Principal, ServiceContext } from '../../ports.js';
import { AccessProblemError } from '../access/problems.js';
import { auditEntryOf } from '../context.js';
import { AccountExportAccountMissingError, collectAccountExport } from './collect.js';
import {
  manifestItemCount,
  type AccountExportFile,
  type CollectedAccountExport,
} from './manifest.js';
import {
  accountExportItemRedacted,
  accountExportPending,
  accountExportTooLarge,
} from './problems.js';

export type AccountExportStatus = 'pending' | 'ready' | 'failed' | 'expired';

/** One `account_exports` row as the service reads it (ids, counts and times; no content). */
export interface AccountExportRow {
  id: string;
  environmentId: string;
  accountId: string;
  status: AccountExportStatus;
  createdAt: Date;
  readyAt: Date | null;
  expiresAt: Date | null;
  itemCount: number | null;
  byteCount: number | null;
  errorCode: 'account_export_too_large' | 'account_export_unavailable' | null;
  /** The sealed manifest's object and wrapped data key, while `ready`. */
  storageKey: string | null;
  wrappedDek: string | null;
}

/** Who asked for an export: an API key or a user, by id. */
export interface AccountExportCreator {
  type: 'api-key' | 'user';
  id: string;
}

/** The store of exports (the repository implements it). */
export interface AccountExportStore {
  /** Locks the account's row for the transaction; `false` when it is not in the environment. */
  lockAccount(tx: Db, environmentId: string, accountId: string): Promise<boolean>;
  /** Whether the account has a `pending` export (under the account's lock). */
  hasPendingExport(tx: Db, environmentId: string, accountId: string): Promise<boolean>;
  createPendingExport(
    tx: Db,
    environmentId: string,
    input: { id: string; accountId: string; creator: AccountExportCreator; at: Date },
  ): Promise<AccountExportRow>;
  getExport(db: Db, environmentId: string, id: string): Promise<AccountExportRow | null>;
}

/** A listed file's live object, or what became of it. */
export type LiveFile =
  | { state: 'live'; storageKey: string; wrappedDek: string; mediaType: string }
  | { state: 'redacted' }
  | { state: 'missing' };

/** Reads a listed file's live object (verification files and transaction files). */
export type LiveFileReader = (
  db: Db,
  environmentId: string,
  file: AccountExportFile,
) => Promise<LiveFile>;

/** What the service needs. */
export interface AccountExportDeps {
  db: Db;
  clock: Clock;
  audit: AuditLogger;
  storage: FileStorage;
  keyring: Keyring;
  ids: { newId(prefix: 'aexp'): string };
  store: AccountExportStore;
  liveFile: LiveFileReader;
  /** Admits the export just created under C251's cap after the create's commit (its job's id). */
  admit(environmentId: string, exportId: string): Promise<void>;
  /** The collector (`collect.ts`); replaced only by tests. */
  collect?:
    ((environmentId: string, accountId: string) => Promise<CollectedAccountExport>) | undefined;
}

/** Who is acting: the route's principal and context. */
export interface AccountExportActing {
  ctx: ServiceContext;
  principal: Principal;
}

/** A served file. */
export interface AccountExportFileContent {
  bytes: Buffer;
  mediaType: string;
}

/** The manifest's object key: under the export's id (C253.2). */
export const manifestStorageKey = (environmentId: string, exportId: string): string =>
  `${environmentId}/account-exports/${exportId}`;

/**
 * C253.1 (review P16): a user needs `pii:view` and a step-up within the window; any principal needs
 * PII visibility (a key minted without `pii:view` is masked, so it cannot export).
 * @throws {PermissionDeniedError} 403 naming `pii:view`.
 * @throws {AccessProblemError} 403 `step_up_required`.
 */
export async function assertMayExport(db: Db, principal: Principal, now: Date): Promise<void> {
  if (!canViewPii(principal)) {
    // A key minted without `pii:view` sees PII masked: it is refused as a user without it is.
    throw new PermissionDeniedError('An account export needs pii:view.', ['pii:view']);
  }
  if (principal.kind !== 'user') {
    return;
  }
  const session = await getUserSession(db, principal.userSessionId);
  const verifiedAt = session?.mfaVerifiedAt ?? null;
  const age = verifiedAt === null ? Infinity : now.getTime() - verifiedAt.getTime();
  if (!(age >= 0 && age <= STEP_UP_WINDOW_SECONDS * 1000)) {
    throw new AccessProblemError(
      'step_up_required',
      'Verify your second factor again before exporting an account.',
    );
  }
}

/** The export as `GET /account-exports/:id` serves it: counts and times, no personal data. */
export function accountExportResource(row: AccountExportRow, now: Date): AccountExportResource {
  const lapsed =
    row.status === 'ready' && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
  const status: AccountExportStatus = lapsed ? 'expired' : row.status;
  const cut = status === 'ready' || status === 'expired';
  return {
    type: 'account-export',
    id: row.id,
    attributes: {
      status,
      'schema-version': ACCOUNT_EXPORT_SCHEMA_VERSION,
      'created-at': row.createdAt.toISOString(),
      'ready-at': cut ? (row.readyAt?.toISOString() ?? null) : null,
      'expires-at': cut ? (row.expiresAt?.toISOString() ?? null) : null,
      'item-count': cut ? row.itemCount : null,
      'byte-count': status === 'ready' ? row.byteCount : null,
      'error-code': status === 'failed' ? row.errorCode : null,
    },
    relationships: { account: { data: { type: 'account', id: row.accountId } } },
  };
}

const creatorOf = (principal: Principal): AccountExportCreator =>
  principal.kind === 'api-key'
    ? { type: 'api-key', id: principal.apiKeyId }
    : { type: 'user', id: principal.userId };

/** `POST /accounts/:id/export`. */
export async function createAccountExport(
  deps: AccountExportDeps,
  acting: AccountExportActing,
  accountId: string,
): Promise<{ data: AccountExportResource }> {
  const { environmentId } = acting.ctx;
  const now = deps.clock.now();
  await assertMayExport(deps.db, acting.principal, now);
  const collect =
    deps.collect ??
    ((environment: string, account: string) =>
      collectAccountExport({ db: deps.db, clock: deps.clock }, environment, account));
  let itemCount: number;
  try {
    itemCount = manifestItemCount(await collect(environmentId, accountId));
  } catch (error) {
    if (error instanceof AccountExportAccountMissingError) {
      throw new NotFoundError(`Account ${accountId} was not found.`);
    }
    throw error;
  }
  if (itemCount > ACCOUNT_EXPORT_LIMITS.items) {
    throw accountExportTooLarge(itemCount);
  }
  const id = deps.ids.newId('aexp');
  const row = await deps.db.transaction(async (tx) => {
    if (!(await deps.store.lockAccount(tx, environmentId, accountId))) {
      throw new NotFoundError(`Account ${accountId} was not found.`);
    }
    if (await deps.store.hasPendingExport(tx, environmentId, accountId)) {
      throw accountExportPending();
    }
    const made = await deps.store.createPendingExport(tx, environmentId, {
      id,
      accountId,
      creator: creatorOf(acting.principal),
      at: now,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, creatorOf(acting.principal), {
        action: 'account-export.created',
        resourceType: 'account-export',
        resourceId: id,
        metadata: { 'account-id': accountId },
      }),
    );
    return made;
  });
  try {
    await deps.admit(environmentId, id);
  } catch {
    // The export stays pending: the fair sweep admits it (C251.1).
  }
  return { data: accountExportResource(row, now) };
}

async function exportOf(
  deps: AccountExportDeps,
  acting: AccountExportActing,
  id: string,
): Promise<AccountExportRow> {
  const row = await deps.store.getExport(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Account export ${id} was not found.`);
  }
  return row;
}

/** `GET /account-exports/:id`. */
export async function getAccountExport(
  deps: AccountExportDeps,
  acting: AccountExportActing,
  id: string,
): Promise<{ data: AccountExportResource }> {
  const now = deps.clock.now();
  await assertMayExport(deps.db, acting.principal, now);
  return { data: accountExportResource(await exportOf(deps, acting, id), now) };
}

/** The manifest of a `ready` export within its life, opened. */
async function openManifest(
  deps: AccountExportDeps,
  acting: AccountExportActing,
  id: string,
  now: Date,
): Promise<{ row: AccountExportRow; manifest: AccountExportManifest }> {
  const row = await exportOf(deps, acting, id);
  const served = accountExportResource(row, now).attributes.status;
  if (served !== 'ready' || row.storageKey === null || row.wrappedDek === null) {
    throw new NotFoundError('This export has no manifest to serve.');
  }
  const ciphertext = await deps.storage.get(row.storageKey);
  if (ciphertext === null) {
    throw new NotFoundError('This export has no manifest to serve.');
  }
  const bytes = decryptBytes({ wrappedDek: row.wrappedDek, ciphertext }, deps.keyring, {
    context: row.id,
  });
  const manifest = accountExportManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  bytes.fill(0);
  return { row, manifest };
}

/** `GET /account-exports/:id/manifest`: audited with ids and counts only. */
export async function getAccountExportManifest(
  deps: AccountExportDeps,
  acting: AccountExportActing,
  id: string,
): Promise<AccountExportManifest> {
  const now = deps.clock.now();
  await assertMayExport(deps.db, acting.principal, now);
  const { row, manifest } = await openManifest(deps, acting, id, now);
  await deps.audit.record(
    deps.db,
    auditEntryOf(acting.ctx, creatorOf(acting.principal), {
      action: 'account-export.manifest-downloaded',
      resourceType: 'account-export',
      resourceId: row.id,
      metadata: { 'account-id': row.accountId, 'item-count': manifest['item-count'] },
    }),
  );
  return manifest;
}

/** `GET /account-exports/:id/files/:fileId`: the live object, audited with ids only. */
export async function getAccountExportFile(
  deps: AccountExportDeps,
  acting: AccountExportActing,
  id: string,
  fileId: string,
): Promise<AccountExportFileContent> {
  const now = deps.clock.now();
  await assertMayExport(deps.db, acting.principal, now);
  const { row, manifest } = await openManifest(deps, acting, id, now);
  const listed = manifest.files.find((file) => file.id === fileId);
  if (listed === undefined) {
    throw new NotFoundError(`File ${fileId} is not listed by this export.`);
  }
  const live = await deps.liveFile(deps.db, acting.ctx.environmentId, listed);
  if (live.state === 'redacted') {
    throw accountExportItemRedacted();
  }
  if (live.state === 'missing') {
    throw new NotFoundError('The content of this file is not available.');
  }
  const ciphertext = await deps.storage.get(live.storageKey);
  if (ciphertext === null) {
    throw accountExportItemRedacted();
  }
  const bytes = decryptBytes({ wrappedDek: live.wrappedDek, ciphertext }, deps.keyring, {
    context: listed.id,
  });
  await deps.audit.record(
    deps.db,
    auditEntryOf(acting.ctx, creatorOf(acting.principal), {
      action: 'account-export.file-downloaded',
      resourceType: 'account-export',
      resourceId: row.id,
      metadata: { 'account-id': row.accountId, 'file-id': listed.id },
    }),
  );
  return { bytes, mediaType: live.mediaType };
}
