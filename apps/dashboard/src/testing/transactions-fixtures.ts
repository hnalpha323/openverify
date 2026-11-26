/**
 * Synthetic API documents for the transactions console (Workflow 7C, C108): transaction types and
 * their versions, transactions and their labels. Every id is a made-up ULID and every field value
 * is fictional (an order of a made-up shop, a note, a file name made up here); each builder parses
 * its result with the contract's builder, so a fixture that drifts from the contract fails where
 * it is built.
 */
import {
  buildTransactionLabelResource,
  buildTransactionResource,
  buildTransactionTypeResource,
  buildTransactionTypeVersionResource,
  transactionRelationResourceSchema,
  transactionStatusChangeResourceSchema,
  type FieldSchema,
  type TransactionFieldValue,
  type TransactionLabelResource,
  type TransactionRelationResource,
  type TransactionResource,
  type TransactionStatusChangeResource,
  type TransactionTypeResource,
  type TransactionTypeVersionResource,
} from '@openverify/contracts';

export const TRANSACTION_IDS = {
  type: 'txntp_01JD0000000000000000000001',
  otherType: 'txntp_01JD0000000000000000000002',
  version: 'txntpv_01JD0000000000000000000001',
  draft: 'txntpv_01JD0000000000000000000002',
  transaction: 'txn_01JD0000000000000000000001',
  otherTransaction: 'txn_01JD0000000000000000000002',
  label: 'txnl_01JD0000000000000000000001',
  file: 'txnf_01JD0000000000000000000001',
  account: 'acc_01JD0000000000000000000001',
  inquiry: 'inq_01JD0000000000000000000001',
  verification: 'ver_01JD0000000000000000000001',
} as const;

export const TT0 = '2026-10-30T09:00:00.000Z';
export const TT1 = '2026-10-30T10:30:00.000Z';

/** A synthetic note value: what a masked read must never carry. */
export const NOTE_VALUE = 'Synthetic note: parcel left with a neighbour';
export const FILE_NAME = 'synthetic-receipt.pdf';

export const FIELD_SCHEMAS: readonly FieldSchema[] = [
  { type: 'string', key: 'note', label: 'Note' },
  { type: 'number', key: 'amount', label: 'Amount' },
  { type: 'file', key: 'receipt', label: 'Receipt' },
];

export const RELATION_SCHEMAS = [{ key: 'payer', target: 'account', cardinality: 'one' }] as const;

export const STATUSES = ['created', 'approved', 'declined', 'needs review'] as const;

export interface TypeOptions {
  readonly id?: string;
  readonly name?: string;
  readonly status?: 'active' | 'archived';
  readonly latestVersion?: number;
  readonly publishedVersion?: number | null;
  /** K7B-3: the `latest-version` relationship; left out, the type has no relationships. */
  readonly latestVersionId?: string;
  readonly publishedVersionId?: string | null;
}

export function transactionType(options: TypeOptions = {}): TransactionTypeResource {
  const published = options.publishedVersion === undefined ? 2 : options.publishedVersion;
  return buildTransactionTypeResource({
    id: options.id ?? TRANSACTION_IDS.type,
    name: options.name ?? 'Synthetic order',
    status: options.status ?? 'active',
    fieldSchemas: published === null ? [] : FIELD_SCHEMAS,
    statuses: published === null ? [] : STATUSES,
    relationSchemas: published === null ? [] : RELATION_SCHEMAS,
    latestVersion: options.latestVersion ?? 3,
    publishedVersion: published,
    ...(options.latestVersionId === undefined
      ? {}
      : {
          latestVersionId: options.latestVersionId,
          publishedVersionId: options.publishedVersionId ?? null,
        }),
    createdAt: new Date(TT0),
    updatedAt: new Date(TT1),
  });
}

export interface VersionOptions {
  readonly id?: string;
  readonly typeId?: string;
  readonly number?: number;
  readonly status?: 'draft' | 'published' | 'superseded';
  readonly fieldSchemas?: readonly FieldSchema[];
}

export function transactionTypeVersion(
  options: VersionOptions = {},
): TransactionTypeVersionResource {
  const status = options.status ?? 'draft';
  return buildTransactionTypeVersionResource({
    id: options.id ?? TRANSACTION_IDS.draft,
    transactionTypeId: options.typeId ?? TRANSACTION_IDS.type,
    versionNumber: options.number ?? 3,
    status,
    fieldSchemas: options.fieldSchemas ?? FIELD_SCHEMAS,
    statuses: STATUSES,
    relationSchemas: RELATION_SCHEMAS,
    allowCardLikeStrings: false,
    createdAt: new Date(TT0),
    publishedAt: status === 'draft' ? null : new Date(TT1),
  });
}

/** The fields as the API serves them to an operator with `pii:view`. */
export const SHOWN_FIELDS: Readonly<Record<string, TransactionFieldValue>> = {
  note: { type: 'string', value: NOTE_VALUE },
  amount: { type: 'number', value: 42.5 },
  receipt: {
    type: 'file',
    value: {
      'file-id': TRANSACTION_IDS.file,
      filename: FILE_NAME,
      'byte-size': 2048,
      'mime-type': 'application/pdf',
    },
  },
};

/** The same fields masked member-wise (C105.8): each key and type stay, every value is null. */
export const MASKED_FIELDS: Readonly<Record<string, TransactionFieldValue>> = Object.fromEntries(
  Object.entries(SHOWN_FIELDS).map(([key, field]) => [key, { type: field.type, value: null }]),
);

export interface TransactionOptions {
  readonly id?: string;
  readonly status?: string;
  readonly referenceId?: string | null;
  readonly fields?: Readonly<Record<string, TransactionFieldValue>> | null;
  readonly tags?: readonly string[];
  readonly labelId?: string | null;
  readonly redacted?: boolean;
  readonly biometricsRedacted?: boolean;
}

export function transaction(options: TransactionOptions = {}): TransactionResource {
  const redacted = options.redacted === true;
  return buildTransactionResource({
    id: options.id ?? TRANSACTION_IDS.transaction,
    status: options.status ?? 'created',
    referenceId: options.referenceId === undefined ? 'order-0001' : options.referenceId,
    fields: redacted ? null : (options.fields ?? SHOWN_FIELDS),
    tags: options.tags ?? ['priority'],
    transactionTypeId: TRANSACTION_IDS.type,
    transactionTypeVersionId: TRANSACTION_IDS.version,
    latestLabelId: options.labelId === undefined ? TRANSACTION_IDS.label : options.labelId,
    relatedObjects: [
      { type: 'account', id: TRANSACTION_IDS.account },
      { type: 'inquiry', id: TRANSACTION_IDS.inquiry },
      { type: 'verification/selfie', id: TRANSACTION_IDS.verification },
    ],
    createdAt: new Date(TT0),
    updatedAt: new Date(TT1),
    redactedAt: redacted ? new Date(TT1) : null,
    biometricsRedactedAt: options.biometricsRedacted === true ? new Date(TT1) : null,
  });
}

export function transactionLabel(): TransactionLabelResource {
  return buildTransactionLabelResource({
    id: TRANSACTION_IDS.label,
    label: 'fraud',
    modelVersion: 'rules-7',
    score: 0.82,
    createdAt: new Date(TT1),
    updatedAt: new Date(TT1),
  });
}

/** K7B-4: one row of a transaction's status history, moved by an API key. */
export function statusChange(
  id: string,
  attributes: Partial<TransactionStatusChangeResource['attributes']> = {},
): TransactionStatusChangeResource {
  return transactionStatusChangeResourceSchema.parse({
    type: 'transaction-status-change',
    id,
    attributes: {
      'from-status': 'created',
      'to-status': 'approved',
      'actor-type': 'api-key',
      'created-at': TT1,
      'redacted-at': null,
      ...attributes,
    },
  });
}

/** K7C-2: one relation of the transaction, its target by a resource identifier. */
export function transactionRelation(
  key: string,
  target: TransactionRelationResource['attributes']['target'],
  createdAt: string = TT1,
): TransactionRelationResource {
  return transactionRelationResourceSchema.parse({
    type: 'transaction-relation',
    id: `${TRANSACTION_IDS.transaction}:${key}:${target.id}`,
    attributes: { 'relation-schema-key': key, target, 'created-at': createdAt },
  });
}

export const pageOf = <T>(data: readonly T[], next: string | null = null) => ({
  data,
  links: { next },
});
