/**
 * C232.1, C233 (Workflow 11A, `api-connect`): what a share's source holds, read from its current
 * rows, and the peek envelope built from it.
 *
 * - {@link loadShareSource} reads one source object of one environment (an inquiry with its
 *   verifications, a verification with its holding inquiry, an account, a transaction) into
 *   `connect-logic`'s `ShareSourceContent`, with the facts the checks of C232.1 need (redacted, the
 *   holding inquiry). It is an ordinary environment-scoped read: the token create calls it in the
 *   caller's own (source) environment, and `cross-tenant.ts`'s `readPeekSource` calls it in the
 *   source environment of a token already bound to its destination caller. Nothing is cached
 *   (C233.4: no `ready`).
 * - {@link peekEnvelopeOf} is the `{visibility, value}` envelope of C233.2 (`connect-logic`'s
 *   `sourceDataOf`), checked against the frozen `sourceDataSchema`: never a file byte, an image or
 *   face data (C233.3).
 *
 * File kinds map to the policy's share kinds: a document's sides and its rendering are
 * `document-image`, an identity document's portrait `portrait`, a selfie's poses `selfie-image`; a
 * chip's files are no share kind (an NFC read is not one of the six shared verification types).
 *
 * A field hydrated from another organisation (C235.1's `hydrated_fields`, keys only) is a copy, so it
 * is left out of the object's fields: a share never passes another organisation's data on under the
 * caller's name (F001/F002, Workflow 11F review, amending C232.1's "a copy" with decision 77, which
 * named clones only). The object's own fields are shared as before.
 */
import { sourceDataSchema, type SourceData, type SharePolicy } from '@openverify/contracts';
import {
  sourceDataOf,
  type ShareFieldEntry,
  type ShareFieldType,
  type ShareFileEntry,
  type ShareFileKind,
  type ShareSourceContent,
  type ShareVerificationEntry,
} from '@openverify/core';
import {
  accounts,
  getAccount,
  getAccountType,
  getInquiry,
  getInquiryTemplateVersion,
  getTransaction,
  getTransactionTypeVersion,
  getVerification,
  inquiries,
  listInquiryVerifications,
  listVerificationFiles,
  transactions,
  type Db,
  type VerificationWithChecks,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { UNMASKED } from '../../auth/pii.js';
import type { ApiDependencies } from '../context.js';
import { getVerificationDocument } from '../verifications.js';

/** C232.1: the source types a share takes, by their id's prefix. */
export const SHARE_SOURCE_TYPE_OF_PREFIX: Readonly<
  Record<string, 'inquiry' | 'account' | 'transaction' | 'verification'>
> = Object.freeze({ inq: 'inquiry', acc: 'account', txn: 'transaction', ver: 'verification' });

/** A source as loaded: its content and the facts C232.1's checks read beside it. */
export interface LoadedShareSource {
  content: ShareSourceContent;
  /** The source, or the inquiry holding a verification source, was redacted. */
  redacted: boolean;
  /** The inquiry holding a verification source; `null` for any other source. */
  holdingInquiryId: string | null;
}

const FILE_SHARE_KIND: Readonly<Record<string, ShareFileKind>> = Object.freeze({
  front: 'document-image',
  back: 'document-image',
  document: 'document-image',
  'document-preview': 'document-image',
  portrait: 'portrait',
  'selfie-center': 'selfie-image',
  'selfie-left': 'selfie-image',
  'selfie-right': 'selfie-image',
});

const isCloned = (provenance: unknown): boolean =>
  typeof provenance === 'object' &&
  provenance !== null &&
  (provenance as { kind?: unknown }).kind === 'connect-clone';

/** The field keys any redemption hydrated into an object (`[{fields: [...]}, ...]`, keys only). */
function hydratedKeysOf(stored: unknown): Set<string> {
  const keys = new Set<string>();
  if (Array.isArray(stored)) {
    for (const entry of stored as unknown[]) {
      const fields = (entry as { fields?: unknown } | null)?.fields;
      if (Array.isArray(fields)) {
        for (const key of fields as unknown[]) {
          if (typeof key === 'string') {
            keys.add(key);
          }
        }
      }
    }
  }
  return keys;
}

/** The object's fields less every key hydrated into it (F001/F002). */
function ownFieldsOf(
  values: Readonly<Record<string, unknown>> | null,
  hydrated: unknown,
): Readonly<Record<string, unknown>> | null {
  const copied = hydratedKeysOf(hydrated);
  if (values === null || copied.size === 0) {
    return values;
  }
  return Object.fromEntries(Object.entries(values).filter(([key]) => !copied.has(key)));
}

/** `{key → type}` of a version's field schemas (template or transaction type). */
function fieldTypesOf(schemas: readonly unknown[]): Map<string, ShareFieldType> {
  const types = new Map<string, ShareFieldType>();
  for (const schema of schemas) {
    if (typeof schema === 'object' && schema !== null) {
      const { key, type } = schema as { key?: unknown; type?: unknown };
      if (typeof key === 'string' && typeof type === 'string') {
        types.set(key, type as ShareFieldType);
      }
    }
  }
  return types;
}

/**
 * The fields of an object with their declared types. A key no schema declares is a `string`: it
 * may hold any value, and the class that needs the more specific consent wins (C230.4).
 */
function fieldEntriesOf(
  values: Readonly<Record<string, unknown>> | null,
  types: ReadonlyMap<string, ShareFieldType>,
): ShareFieldEntry[] {
  return Object.entries(values ?? {}).map(([key, value]) => ({
    key,
    type: types.get(key) ?? 'string',
    value: value ?? null,
  }));
}

const iso = (date: Date | null | undefined): string | null =>
  date === null || date === undefined ? null : date.toISOString();

/** The verifications as `connect-logic` reads them, with their files and served attributes. */
async function verificationEntriesOf(
  db: Db,
  environmentId: string,
  rows: readonly VerificationWithChecks[],
): Promise<ShareVerificationEntry[]> {
  const files = await listVerificationFiles(
    db,
    environmentId,
    rows.map((row) => row.id),
  );
  const entries: ShareVerificationEntry[] = [];
  for (const row of rows) {
    const document = await getVerificationDocument(
      { db } as ApiDependencies,
      environmentId,
      row.id,
      UNMASKED,
    );
    const fileEntries: ShareFileEntry[] = files
      .filter((file) => file.verificationId === row.id)
      .flatMap((file) => {
        const kind = FILE_SHARE_KIND[file.kind];
        return kind === undefined ? [] : [{ id: file.id, kind }];
      });
    entries.push({
      id: row.id,
      type: row.type,
      status: row.status,
      cloned: isCloned(row.provenance),
      fromRejectedHandoff: row.fromRejectedHandoff,
      attributes: { ...(document.data.attributes as Record<string, unknown>) },
      checks: row.checks.map((check) => ({ name: check.name, status: check.status })),
      files: fileEntries,
    });
  }
  return entries;
}

/** The stored `hydrated_fields` of one inquiry, account or transaction (null when none). */
async function hydratedFieldsOf(
  db: Db,
  type: 'inquiry' | 'account' | 'transaction',
  environmentId: string,
  id: string,
): Promise<unknown> {
  const table = type === 'inquiry' ? inquiries : type === 'account' ? accounts : transactions;
  const [row] = await db
    .select({ hydratedFields: table.hydratedFields })
    .from(table)
    .where(and(eq(table.environmentId, environmentId), eq(table.id, id)));
  return row?.hydratedFields ?? null;
}

/**
 * C232.1, C233.4: one source object of `environmentId` as it is now, or `null` when it is not there
 * (the caller answers the one 404).
 */
export async function loadShareSource(
  db: Db,
  environmentId: string,
  sourceType: 'inquiry' | 'account' | 'transaction' | 'verification',
  sourceId: string,
): Promise<LoadedShareSource | null> {
  switch (sourceType) {
    case 'inquiry': {
      const inquiry = await getInquiry(db, environmentId, sourceId);
      if (inquiry === null) {
        return null;
      }
      const version = await getInquiryTemplateVersion(
        db,
        environmentId,
        inquiry.inquiryTemplateVersionId,
      );
      const verifications = await verificationEntriesOf(
        db,
        environmentId,
        await listInquiryVerifications(db, environmentId, inquiry.id),
      );
      return {
        redacted: inquiry.redactedAt !== null,
        holdingInquiryId: null,
        content: {
          type: 'inquiry',
          object: {
            id: inquiry.id,
            cloned: isCloned(inquiry.provenance),
            attributes: {
              status: inquiry.status,
              'created-at': iso(inquiry.createdAt),
              'decisioned-at': iso(inquiry.decisionedAt),
            },
            fields: fieldEntriesOf(
              ownFieldsOf(
                inquiry.fields,
                await hydratedFieldsOf(db, 'inquiry', environmentId, inquiry.id),
              ),
              fieldTypesOf(version?.fieldSchemas ?? []),
            ),
          },
          verifications,
        },
      };
    }
    case 'verification': {
      const verification = await getVerification(db, environmentId, sourceId);
      if (verification === null) {
        return null;
      }
      const inquiry = await getInquiry(db, environmentId, verification.inquiryId);
      const [entry] = await verificationEntriesOf(db, environmentId, [verification]);
      if (entry === undefined) {
        return null;
      }
      return {
        redacted: inquiry?.redactedAt !== null,
        holdingInquiryId: verification.inquiryId,
        content: { type: 'verification', verification: entry },
      };
    }
    case 'account': {
      const account = await getAccount(db, environmentId, sourceId);
      if (account === null) {
        return null;
      }
      const type = await getAccountType(db, environmentId, account.accountTypeId);
      const types = new Map<string, ShareFieldType>(
        Object.entries(type?.fieldsSchema ?? {}).map(([key, schema]) => [
          key,
          schema.type as ShareFieldType,
        ]),
      );
      return {
        redacted: account.redactedAt !== null,
        holdingInquiryId: null,
        content: {
          type: 'account',
          object: {
            id: account.id,
            cloned: false,
            attributes: { status: account.status, 'created-at': iso(account.createdAt) },
            fields: fieldEntriesOf(
              ownFieldsOf(
                account.fields,
                await hydratedFieldsOf(db, 'account', environmentId, account.id),
              ),
              types,
            ),
          },
        },
      };
    }
    case 'transaction': {
      const transaction = await getTransaction(db, environmentId, sourceId);
      if (transaction === null) {
        return null;
      }
      const version = await getTransactionTypeVersion(
        db,
        environmentId,
        transaction.transactionTypeVersionId,
      );
      return {
        redacted: transaction.redactedAt !== null,
        holdingInquiryId: null,
        content: {
          type: 'transaction',
          object: {
            id: transaction.id,
            cloned: false,
            attributes: { status: transaction.status, 'created-at': iso(transaction.createdAt) },
            fields: fieldEntriesOf(
              ownFieldsOf(
                transaction.fields,
                await hydratedFieldsOf(db, 'transaction', environmentId, transaction.id),
              ),
              fieldTypesOf(version?.fieldSchemas ?? []),
            ),
          },
        },
      };
    }
  }
}

/**
 * C233.2, C233.3: the peek's `source-data` of a source under a policy version, or `null` when the
 * policy shares nothing of it now. Parsed with the frozen schema, so a value the envelope may not
 * carry fails here, never on the wire.
 */
export function peekEnvelopeOf(
  policy: SharePolicy,
  content: ShareSourceContent,
): SourceData | null {
  const envelope = sourceDataOf(policy, content);
  return envelope === null ? null : sourceDataSchema.parse(envelope);
}
