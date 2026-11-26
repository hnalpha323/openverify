/**
 * Synthetic API documents for the lists console (Workflow 7C, C108): lists, items, importers and
 * their error rows. Every id is a made-up ULID, every value is fictional (emails at `.example`,
 * addresses from the documentation ranges, a fingerprint and a digest made from a seed), and each
 * builder parses its result with the contract's builder, so a fixture that drifts from the
 * contract fails where it is built.
 */
import { createHash } from 'node:crypto';
import {
  buildImporterResource,
  buildListItemResource,
  buildListResource,
  listLimitsMeta,
  type ImporterError,
  type ImporterResource,
  type ListItemResource,
  type ListResource,
} from '@openverify/contracts';
import type { ImporterStatus, ListKind } from '@openverify/core';

export const LIST_IDS = {
  list: 'lst_01JC0000000000000000000001',
  otherList: 'lst_01JC0000000000000000000002',
  faceList: 'lst_01JC0000000000000000000003',
  item: 'liea_01JC0000000000000000000001',
  otherItem: 'liea_01JC0000000000000000000002',
  importer: 'mprt_01JC0000000000000000000001',
  otherImporter: 'mprt_01JC0000000000000000000002',
  inquiry: 'inq_01JC0000000000000000000001',
  user: 'usr_01JC0000000000000000000001',
} as const;

export const LT0 = '2026-10-29T09:00:00.000Z';
export const LT1 = '2026-10-29T10:30:00.000Z';

/** A synthetic SHA-256: the digest of a seed, never of any real file. */
export function seededSha256(seed: string): string {
  return createHash('sha256').update(`openverify/lists-fixtures/${seed}`).digest('hex');
}

/** What each kind's list carries beyond the shared members (C97.2). */
const KIND_ATTRIBUTES: Readonly<Record<ListKind, Readonly<Record<string, unknown>>>> = {
  'browser-fingerprint': {},
  'device-fingerprint': {},
  country: {},
  'email-address': {},
  face: {},
  geolocation: {},
  'government-id-number': { 'use-for-compromised-ids': false },
  field: { 'field-key': 'merchant_code' },
  'ip-address': {},
  name: { 'allow-fuzzy-name-first': false },
  'phone-number': { 'default-region': null },
  'selfie-background': {},
  string: { 'case-sensitive': false },
};

export interface ListOptions {
  readonly id?: string;
  readonly name?: string;
  readonly status?: 'active' | 'archived';
  readonly itemCount?: number;
  readonly version?: number;
  readonly itemRetentionDays?: number | null;
  readonly screenAtCompletion?: boolean;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export function listResource(kind: ListKind, options: ListOptions = {}): ListResource {
  const status = options.status ?? 'active';
  const biometric = kind === 'face' || kind === 'selfie-background';
  return buildListResource({
    id: options.id ?? LIST_IDS.list,
    kind,
    name: options.name ?? 'Synthetic blocked senders',
    status,
    archivedAt: status === 'archived' ? new Date(LT1) : null,
    createdAt: new Date(LT0),
    updatedAt: new Date(LT1),
    itemCount: options.itemCount ?? 2,
    version: options.version ?? 3,
    itemRetentionDays:
      options.itemRetentionDays === undefined ? (biometric ? 90 : null) : options.itemRetentionDays,
    screenAtCompletion: options.screenAtCompletion ?? true,
    attributes: { ...KIND_ATTRIBUTES[kind], ...options.attributes },
  });
}

export const listDocument = (list: ListResource) => ({
  data: list,
  meta: listLimitsMeta(list.type.slice('list/'.length) as ListKind),
});

export const pageOf = <T>(data: readonly T[], next: string | null = null) => ({
  data,
  links: { next },
});

export interface ItemOptions {
  readonly id?: string;
  readonly listId?: string;
  readonly status?: 'pending' | 'active' | 'archived';
  readonly matchCount?: number;
  readonly redacted?: boolean;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** An email item; its value is `null` when `attributes` masks it. */
export function emailItem(options: ItemOptions = {}): ListItemResource {
  return listItem('email-address', {
    ...options,
    attributes: {
      value: 'blocked.sender@mail.example',
      'match-type': 'email_address',
      ...options.attributes,
    },
  });
}

export function listItem(kind: ListKind, options: ItemOptions = {}): ListItemResource {
  const status = options.status ?? 'active';
  return buildListItemResource({
    id: options.id ?? LIST_IDS.item,
    kind,
    listId: options.listId ?? LIST_IDS.list,
    status,
    archivedAt: status === 'archived' ? new Date(LT1) : null,
    createdAt: new Date(LT0),
    updatedAt: new Date(LT1),
    redactedAt: options.redacted === true ? new Date(LT1) : null,
    matchCount: options.matchCount ?? 0,
    creator: { type: 'user', id: LIST_IDS.user },
    attributes: options.attributes ?? {},
  });
}

export interface ImporterOptions {
  readonly id?: string;
  readonly listId?: string;
  readonly status?: ImporterStatus;
  readonly mode?: 'all-or-nothing' | 'skip-invalid';
  readonly rowCount?: number;
  readonly successfulCount?: number;
  readonly duplicateCount?: number;
  readonly alreadyPresentCount?: number;
  readonly errorCount?: number;
}

export function importer(kind: ListKind, options: ImporterOptions = {}): ImporterResource {
  const status = options.status ?? 'ready';
  return buildImporterResource({
    id: options.id ?? LIST_IDS.importer,
    kind,
    listId: options.listId ?? LIST_IDS.list,
    status,
    mode: options.mode ?? 'all-or-nothing',
    rowCount: options.rowCount ?? 3,
    successfulCount: options.successfulCount ?? (status === 'ready' ? 3 : 0),
    duplicateCount: options.duplicateCount ?? 0,
    alreadyPresentCount: options.alreadyPresentCount ?? 0,
    errorCount: options.errorCount ?? 0,
    encoding: 'utf-8',
    fileSha256: seededSha256('import-file'),
    createdAt: new Date(LT0),
    completedAt: status === 'pending' ? null : new Date(LT1),
  });
}

export const importerErrors = (
  errors: readonly ImporterError[] = [
    { row: null, column: null, code: 'missing_column' },
    { row: 4, column: 'value', code: 'invalid_value' },
  ],
  next: string | null = null,
) => pageOf(errors, next);
