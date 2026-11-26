/**
 * C230.3, C230.4, C232.1, C234.2 (Phase 11, Workflow 11A Stage 2; `connect-logic`): what a share
 * holds. A caller describes the source's current rows as {@link ShareSourceContent}; the policy
 * filters them into {@link SharedContent}, which the peek envelope (C233), the token's stored
 * categories (C230.4) and the redemption's copy (C234.2) all read, so the three can never disagree.
 */
import { getCheckDefinition } from '../check-registry.js';
import {
  SHARE_CATEGORIES,
  WELL_KNOWN_FIELD_CATEGORY,
  fieldShareCategory,
  type ShareCategory,
  type ShareFieldType,
} from './categories.js';
import {
  BIOMETRIC_CHECK_NAMES,
  BIOMETRIC_FILE_KINDS,
  VERIFICATION_TYPE_OF_SHARE_KIND,
  checkShared,
  fileKindShared,
  isBiometricCheck,
  shareKindOfVerificationType,
  verificationKindShared,
  type ShareFieldObjectKind,
  type ShareFileKind,
  type SharePolicyRules,
  type ShareSourceKind,
  type ShareVerificationKind,
} from './policy.js';

/** One field of an inquiry, an account or a transaction; `null` when the source holds no value. */
export interface ShareFieldEntry {
  readonly key: string;
  readonly type: ShareFieldType;
  readonly value: unknown;
}

/** One file of a verification, by kind; never its bytes. */
export interface ShareFileEntry {
  readonly id: string;
  readonly kind: ShareFileKind;
}

/** One check result of a verification. */
export interface ShareCheckEntry {
  readonly name: string;
  readonly status: string;
}

/**
 * A verification as the source holds it. `type` is core's verification type (`government_id`);
 * `attributes` is the verification's resource attributes (kebab-case) beside `status`: the
 * metadata of {@link VERIFICATION_BASE_ATTRIBUTES} and the extracted data, which only
 * `extracted-data` shares.
 */
export interface ShareVerificationEntry {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  /** A Connect clone (its provenance is `connect-clone`): never shared again (review H03). */
  readonly cloned: boolean;
  /** Phase 7's `from-rejected-handoff`: never a share's (Stage 1a amendment 17). */
  readonly fromRejectedHandoff: boolean;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly checks: readonly ShareCheckEntry[];
  readonly files: readonly ShareFileEntry[];
}

/** An inquiry, an account or a transaction as the source holds it. */
export interface ShareObjectEntry {
  readonly id: string;
  /** An inquiry made by a Connect clone (review H03). */
  readonly cloned: boolean;
  /** Resource attributes; only {@link OBJECT_BASE_ATTRIBUTES} of the type are ever shared. */
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly fields: readonly ShareFieldEntry[];
}

/** C232.1: a share's source and everything under it, as it is now. */
export type ShareSourceContent =
  | {
      readonly type: 'inquiry';
      readonly object: ShareObjectEntry;
      readonly verifications: readonly ShareVerificationEntry[];
    }
  | { readonly type: 'account' | 'transaction'; readonly object: ShareObjectEntry }
  | { readonly type: 'verification'; readonly verification: ShareVerificationEntry };

/** The non-personal attributes a shared object always carries (C233.2's base attributes). */
export const OBJECT_BASE_ATTRIBUTES: Readonly<Record<ShareFieldObjectKind, readonly string[]>> =
  Object.freeze({
    inquiry: ['status', 'created-at', 'decisioned-at'],
    account: ['status', 'created-at'],
    transaction: ['status', 'created-at'],
  });

/**
 * The attributes of a shared verification that are not extracted data: its status, its creation
 * time, and an identity document's issuing country and class (identity data: C230.4 classes them
 * `identity-fields`).
 */
export const VERIFICATION_BASE_ATTRIBUTES: readonly string[] = Object.freeze([
  'status',
  'created-at',
  'country',
  'id-class',
]);

/**
 * Attributes that are neither metadata a share carries nor extracted data: the checks and files
 * (carried as their own parts), and bookkeeping the destination's copy gets afresh.
 */
const RESERVED_VERIFICATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'checks',
  'files',
  'updated-at',
  'redacted-at',
  'from-rejected-handoff',
  'retry-hints',
]);

/** C234.3: a verification's statuses that are a decision a share can carry. */
export const DECIDED_VERIFICATION_STATUSES: readonly string[] = Object.freeze(['passed', 'failed']);

/**
 * The file kinds each verification type holds; a file of another kind is not that verification's
 * evidence and is never carried (a portrait only on an identity document, a selfie image only on a
 * selfie; a database, email or phone verification holds no file).
 */
export const FILE_KINDS_OF_SHARE_KIND: Readonly<
  Record<ShareVerificationKind, readonly ShareFileKind[]>
> = Object.freeze({
  'government-id': ['document-image', 'other-upload', 'portrait'],
  selfie: ['selfie-image'],
  database: [],
  document: ['document-image', 'other-upload'],
  'email-address': [],
  'phone-number': [],
});

/** A verification as a share carries it, after the policy's filter. */
export interface SharedVerification {
  readonly id: string;
  readonly kind: ShareVerificationKind;
  readonly status: string;
  /** {@link VERIFICATION_BASE_ATTRIBUTES} the source holds, `status` among them. */
  readonly base: Readonly<Record<string, unknown>>;
  /** The extracted data, only when `extracted-data` is on. */
  readonly extracted: Readonly<Record<string, unknown>>;
  /** Only when `check-results` is on; a face-match or liveness result only with `biometric`. */
  readonly checks: readonly ShareCheckEntry[];
  /** Only when `files` is on; a portrait or a selfie image only with `biometric`; never a template. */
  readonly files: readonly ShareFileEntry[];
}

/** An inquiry, an account or a transaction as a share carries it. */
export interface SharedObject {
  readonly id: string;
  readonly base: Readonly<Record<string, unknown>>;
  /** Only the allowlisted fields, in the source's order. */
  readonly fields: readonly ShareFieldEntry[];
}

/** C234.2: exactly what a share may copy (and a peek may show) of a source. */
export type SharedContent =
  | {
      readonly type: 'inquiry';
      readonly object: SharedObject;
      readonly verifications: readonly SharedVerification[];
    }
  | { readonly type: 'account' | 'transaction'; readonly object: SharedObject }
  | { readonly type: 'verification'; readonly verification: SharedVerification };

/** The source type of a content. */
export function sourceKindOf(content: ShareSourceContent): ShareSourceKind {
  return content.type;
}

const held = (value: unknown): boolean => value !== null && value !== undefined;

function pick(
  attributes: Readonly<Record<string, unknown>>,
  names: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const name of names) {
    if (Object.hasOwn(attributes, name) && attributes[name] !== undefined) {
      picked[name] = attributes[name];
    }
  }
  return picked;
}

function sharedObject(
  policy: SharePolicyRules,
  kind: ShareFieldObjectKind,
  object: ShareObjectEntry,
): SharedObject {
  const allowlist = policy.fields[kind];
  return {
    id: object.id,
    base: pick(object.attributes, OBJECT_BASE_ATTRIBUTES[kind]),
    fields: object.fields.filter((entry) => allowlist.includes(entry.key)),
  };
}

/** A verification a share may carry: a decided, uncopied one of a type the policy shares. */
function shareableKind(
  policy: SharePolicyRules,
  entry: ShareVerificationEntry,
): ShareVerificationKind | null {
  const kind = shareKindOfVerificationType(entry.type);
  const shareable =
    kind !== null &&
    verificationKindShared(policy, kind) &&
    DECIDED_VERIFICATION_STATUSES.includes(entry.status) &&
    !entry.cloned &&
    !entry.fromRejectedHandoff;
  return shareable ? kind : null;
}

function sharedVerification(
  policy: SharePolicyRules,
  kind: ShareVerificationKind,
  entry: ShareVerificationEntry,
): SharedVerification {
  const base: Record<string, unknown> = {
    status: entry.status,
    ...pick(entry.attributes, VERIFICATION_BASE_ATTRIBUTES.slice(1)),
  };
  const extracted: Record<string, unknown> = {};
  if (policy.verifications['extracted-data']) {
    for (const [name, value] of Object.entries(entry.attributes)) {
      if (
        value !== undefined &&
        !VERIFICATION_BASE_ATTRIBUTES.includes(name) &&
        !RESERVED_VERIFICATION_ATTRIBUTES.has(name)
      ) {
        extracted[name] = value;
      }
    }
  }
  const type = VERIFICATION_TYPE_OF_SHARE_KIND[kind];
  const kinds = FILE_KINDS_OF_SHARE_KIND[kind];
  return {
    id: entry.id,
    kind,
    status: entry.status,
    base,
    extracted,
    checks: entry.checks.filter(
      (check) =>
        getCheckDefinition(check.name)?.verificationType === type &&
        checkShared(policy, check.name),
    ),
    files: entry.files.filter(
      (file) => kinds.includes(file.kind) && fileKindShared(policy, file.kind),
    ),
  };
}

/**
 * C230.3, C234.3: the part of `content` the policy shares, or `null` when the policy does not share
 * the source itself (its type; a verification source's type; a verification source that is a
 * copy, undecided or from a rejected handoff). An inquiry carries its base attributes, its
 * allowlisted fields and each shareable verification (decided, uncopied, of a listed type); each
 * verification its status and base attributes, its extracted data with `extracted-data`, its own
 * checks with `check-results` (a face-match or liveness result only with `biometric`), and its own
 * files with `files` (a portrait or a selfie image only with `biometric`, a face template never).
 */
export function shareableContent(
  policy: SharePolicyRules,
  content: ShareSourceContent,
): SharedContent | null {
  if (!policy['source-types'].includes(content.type)) {
    return null;
  }
  switch (content.type) {
    case 'inquiry':
      return {
        type: 'inquiry',
        object: sharedObject(policy, 'inquiry', content.object),
        verifications: content.verifications.flatMap((entry) => {
          const kind = shareableKind(policy, entry);
          return kind === null ? [] : [sharedVerification(policy, kind, entry)];
        }),
      };
    case 'account':
    case 'transaction':
      return { type: content.type, object: sharedObject(policy, content.type, content.object) };
    case 'verification': {
      const kind = shareableKind(policy, content.verification);
      return kind === null
        ? null
        : {
            type: 'verification',
            verification: sharedVerification(policy, kind, content.verification),
          };
    }
  }
}

/** C232.1 (review H03, decision 77): `source_is_copy`: the source is a clone or holds one. */
export function sourceIsCopy(content: ShareSourceContent): boolean {
  switch (content.type) {
    case 'inquiry':
      return content.object.cloned || content.verifications.some((entry) => entry.cloned);
    case 'account':
    case 'transaction':
      return content.object.cloned;
    case 'verification':
      return content.verification.cloned;
  }
}

/** C232.1: `source_not_decided`: a verification source is neither passed nor failed. */
export function sourceNotDecided(content: ShareSourceContent): boolean {
  return (
    content.type === 'verification' &&
    !DECIDED_VERIFICATION_STATUSES.includes(content.verification.status)
  );
}

const ordered = (categories: ReadonlySet<ShareCategory>): ShareCategory[] =>
  SHARE_CATEGORIES.filter((category) => categories.has(category));

/** The category of an extracted attribute without a well-known key, by its verification's type. */
const EXTRACTED_DEFAULT_CATEGORY: Readonly<Record<ShareVerificationKind, ShareCategory>> =
  Object.freeze({
    'government-id': 'identity-fields',
    selfie: 'biometric',
    database: 'identity-fields',
    document: 'identity-fields',
    'email-address': 'contact-fields',
    'phone-number': 'contact-fields',
  });

const fileCategory = (kind: ShareFileKind): ShareCategory =>
  BIOMETRIC_FILE_KINDS.includes(kind) ? 'biometric' : 'document-images';

function addVerificationCategories(
  categories: Set<ShareCategory>,
  verification: SharedVerification,
): void {
  // A status is the outcome of checks: a result; a selfie's is a liveness and face result.
  categories.add('check-results');
  if (verification.kind === 'selfie') {
    categories.add('biometric');
  }
  for (const [name, value] of Object.entries(verification.base)) {
    if (name !== 'status' && name !== 'created-at' && held(value)) {
      categories.add('identity-fields');
    }
  }
  for (const [name, value] of Object.entries(verification.extracted)) {
    if (held(value)) {
      categories.add(
        Object.hasOwn(WELL_KNOWN_FIELD_CATEGORY, name)
          ? (WELL_KNOWN_FIELD_CATEGORY[name] ?? 'identity-fields')
          : EXTRACTED_DEFAULT_CATEGORY[verification.kind],
      );
    }
  }
  for (const check of verification.checks) {
    categories.add('check-results');
    if (isBiometricCheck(check.name)) {
      categories.add('biometric');
    }
  }
  for (const file of verification.files) {
    categories.add(fileCategory(file.kind));
  }
}

/**
 * C230.4: the categories a filtered share carries, in `SHARE_CATEGORIES` order. A field the source
 * holds a value in counts by its well-known key, else its type; an inquiry's status and every
 * verification's status count as `check-results` (a decision is a result); a selfie is always
 * `biometric`; an identity document's country and class are `identity-fields`; an extracted value by
 * its well-known key, else by its verification's type; a face-match or liveness check is
 * `biometric` beside `check-results`; a portrait or a selfie image is `biometric`, any other file
 * `document-images`. The token stores these at creation, and the redemption refuses a copy that
 * carries one outside them (review H04).
 */
export function shareCategoriesOf(shared: SharedContent): ShareCategory[] {
  const categories = new Set<ShareCategory>();
  if (shared.type === 'verification') {
    addVerificationCategories(categories, shared.verification);
    return ordered(categories);
  }
  if (shared.type === 'inquiry' && held(shared.object.base.status)) {
    categories.add('check-results');
  }
  for (const entry of shared.object.fields) {
    if (held(entry.value)) {
      categories.add(fieldShareCategory(entry.key, entry.type));
    }
  }
  if (shared.type === 'inquiry') {
    for (const verification of shared.verifications) {
      addVerificationCategories(categories, verification);
    }
  }
  return ordered(categories);
}

/**
 * What a verification type's extracted data can hold, by the attributes its resource names
 * (`verification-attributes.ts`): an identity document's and a document's identity data, a
 * database body's names, addresses, phone and email, an email or a phone verification's own
 * address or number, a selfie's scores (biometric).
 */
const EXTRACTED_CATEGORIES_OF_KIND: Readonly<
  Record<ShareVerificationKind, readonly ShareCategory[]>
> = Object.freeze({
  'government-id': ['identity-fields'],
  selfie: ['biometric'],
  database: ['identity-fields', 'contact-fields'],
  document: ['identity-fields'],
  'email-address': ['contact-fields'],
  'phone-number': ['contact-fields'],
});

/** The verification types that own a biometric check (from the check registry). */
const BIOMETRIC_CHECK_TYPES: ReadonlySet<string> = new Set(
  BIOMETRIC_CHECK_NAMES.flatMap((name) => getCheckDefinition(name)?.verificationType ?? []),
);

function addKindCategories(
  categories: Set<ShareCategory>,
  policy: SharePolicyRules,
  kind: ShareVerificationKind,
): void {
  categories.add('check-results');
  if (kind === 'selfie') {
    categories.add('biometric');
  }
  if (kind === 'government-id') {
    categories.add('identity-fields');
  }
  if (policy.verifications['extracted-data']) {
    for (const category of EXTRACTED_CATEGORIES_OF_KIND[kind]) {
      categories.add(category);
    }
  }
  if (
    policy.verifications['check-results'] &&
    policy.biometric &&
    BIOMETRIC_CHECK_TYPES.has(VERIFICATION_TYPE_OF_SHARE_KIND[kind])
  ) {
    categories.add('biometric');
  }
  for (const fileKind of FILE_KINDS_OF_SHARE_KIND[kind]) {
    if (fileKindShared(policy, fileKind)) {
      categories.add(fileCategory(fileKind));
    }
  }
}

/**
 * C230.4, C238.3: the categories a policy can carry from a source of `sourceType`, for the consent
 * a flow asks before any token exists: every category {@link shareCategoriesOf} could answer for
 * such a source under this policy, so that the consent covers the token made later. `fieldTypes`
 * are the declared types of the allowlisted keys (the template's, the account type's or the
 * transaction type's fields); a key without one is read as a `string`.
 */
export function policyShareCategories(
  policy: SharePolicyRules,
  sourceType: ShareSourceKind,
  fieldTypes: Readonly<Record<string, ShareFieldType>>,
): ShareCategory[] {
  const categories = new Set<ShareCategory>();
  if (!policy['source-types'].includes(sourceType)) {
    return [];
  }
  if (sourceType !== 'verification') {
    for (const key of policy.fields[sourceType]) {
      categories.add(
        fieldShareCategory(
          key,
          Object.hasOwn(fieldTypes, key) ? (fieldTypes[key] ?? 'string') : 'string',
        ),
      );
    }
  }
  if (sourceType === 'inquiry' || sourceType === 'verification') {
    if (sourceType === 'inquiry') {
      categories.add('check-results');
    }
    for (const kind of policy.verifications.types) {
      if (verificationKindShared(policy, kind)) {
        addKindCategories(categories, policy, kind);
      }
    }
  }
  return ordered(categories);
}
