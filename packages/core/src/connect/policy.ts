/**
 * C230.3 (Phase 11, Workflow 11A Stage 2; `connect-logic`): the share policy's rules, pure. The
 * policy's schema is `@openverify/contracts`' `storedSharePolicySchema`; this module reads a parsed
 * policy through {@link SharePolicyRules}, a structural view of it, because `@openverify/core`
 * cannot import the contracts package (the contracts import this one).
 *
 * The rules: `selfie` needs `biometric: true`; with `biometric: false`, ID portraits and every
 * face-match and liveness result stay out of a share even with `check-results` and `files` on; a
 * face template is never shared, whatever the policy says (decision 23); a peek path outside what
 * the policy shares is refused; `attested-consent` says which shares an attested source consent may
 * authorise (review P03).
 */
import { CHECK_REGISTRY } from '../check-registry.js';
import type { VerificationType } from '../enums.js';

/** C230.3: the six verification types a share can carry, in the public spelling. */
export const SHARE_VERIFICATION_KINDS = Object.freeze([
  'government-id',
  'selfie',
  'database',
  'document',
  'email-address',
  'phone-number',
] as const);
export type ShareVerificationKind = (typeof SHARE_VERIFICATION_KINDS)[number];

/** Core's verification type behind each share type. */
export const VERIFICATION_TYPE_OF_SHARE_KIND: Readonly<
  Record<ShareVerificationKind, VerificationType>
> = Object.freeze({
  'government-id': 'government_id',
  selfie: 'selfie',
  database: 'database',
  document: 'document',
  'email-address': 'email_address',
  'phone-number': 'phone_number',
});

/** C230.3, C232.1: what a share's source can be. */
export const SHARE_SOURCE_KINDS = Object.freeze([
  'inquiry',
  'account',
  'transaction',
  'verification',
] as const);
export type ShareSourceKind = (typeof SHARE_SOURCE_KINDS)[number];

/** The three source types with a `fields` bucket and an allowlist. */
export const SHARE_FIELD_OBJECT_KINDS = Object.freeze([
  'inquiry',
  'account',
  'transaction',
] as const);
export type ShareFieldObjectKind = (typeof SHARE_FIELD_OBJECT_KINDS)[number];

export type SharePeekVisibility = 'full' | 'presence';
export type ShareAttestedConsent = 'none' | 'non-biometric' | 'all';

/**
 * A parsed share-policy version's body, as `storedSharePolicySchema` holds it (C230.3). Every
 * member is read only; a contracts `SharePolicy` is assignable to it.
 */
export interface SharePolicyRules {
  readonly purpose: string;
  readonly 'source-types': readonly ShareSourceKind[];
  readonly verifications: {
    readonly types: readonly ShareVerificationKind[];
    readonly 'extracted-data': boolean;
    readonly 'check-results': boolean;
    readonly files: boolean;
  };
  readonly fields: Readonly<Record<ShareFieldObjectKind, readonly string[]>>;
  readonly biometric: boolean;
  readonly peek: Readonly<Record<string, SharePeekVisibility>>;
  readonly 'attested-consent': ShareAttestedConsent;
}

const SHARE_KIND_OF_TYPE: ReadonlyMap<string, ShareVerificationKind> = new Map(
  SHARE_VERIFICATION_KINDS.map((kind) => [VERIFICATION_TYPE_OF_SHARE_KIND[kind], kind]),
);

/** The share type of a core verification type, or `null` for a type no share carries. */
export function shareKindOfVerificationType(type: string): ShareVerificationKind | null {
  return SHARE_KIND_OF_TYPE.get(type) ?? null;
}

/**
 * C230.3 (decision 23): the face-match and liveness checks, by name. Every check of a selfie
 * describes a face image (liveness, quality, matches, repeats), so all of them are biometric; of an
 * identity document, the three that compare its portrait with a face.
 */
export const BIOMETRIC_CHECK_NAMES: readonly string[] = Object.freeze([
  ...CHECK_REGISTRY.filter((check) => check.verificationType === 'selfie').map((check) => check.id),
  'id_selfie_comparison',
  'id_nfc_selfie_comparison',
  'id_public_figure_detection',
]);
const BIOMETRIC_CHECKS: ReadonlySet<string> = new Set(BIOMETRIC_CHECK_NAMES);

/** Whether a check's result is biometric data. */
export function isBiometricCheck(name: string): boolean {
  return BIOMETRIC_CHECKS.has(name);
}

/**
 * The kinds of a verification's files a share reads. `face-template` is never shared (decision
 * 23); it is in the list so that a caller that passes one sees it dropped.
 */
export const SHARE_FILE_KINDS = Object.freeze([
  'document-image',
  'other-upload',
  'portrait',
  'selfie-image',
  'face-template',
] as const);
export type ShareFileKind = (typeof SHARE_FILE_KINDS)[number];

/** The file kinds that are biometric data: an ID portrait and a selfie image. */
export const BIOMETRIC_FILE_KINDS: readonly ShareFileKind[] = Object.freeze([
  'portrait',
  'selfie-image',
]);

/** Whether a policy lets a file of `kind` into a share. */
export function fileKindShared(policy: SharePolicyRules, kind: ShareFileKind): boolean {
  if (kind === 'face-template' || !policy.verifications.files) {
    return false;
  }
  return policy.biometric || !BIOMETRIC_FILE_KINDS.includes(kind);
}

/** Whether a policy lets a check's result into a share. */
export function checkShared(policy: SharePolicyRules, name: string): boolean {
  return policy.verifications['check-results'] && (policy.biometric || !isBiometricCheck(name));
}

/** Whether a policy shares a verification of `kind` at all (a selfie only with `biometric`). */
export function verificationKindShared(
  policy: SharePolicyRules,
  kind: ShareVerificationKind,
): boolean {
  return policy.verifications.types.includes(kind) && (kind !== 'selfie' || policy.biometric);
}

const PEEK_VERIFICATION_PREFIX = 'verification/';
const PEEK_FIELD_MARK = 'fields.';
const PEEK_FIELD_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PEEK_ATTRIBUTE = /^[a-z][a-z0-9-]{0,63}$/;
const PEEK_PATH_MAX_LENGTH = 160;

/** A peek path's parts (Stage 1a amendment 26's grammar), or `null` for a path outside it. */
function peekPathParts(
  path: string,
): { readonly subtype: string; readonly fieldKey: string | null } | null {
  if (path.length > PEEK_PATH_MAX_LENGTH) {
    return null;
  }
  const subtypes = [
    ...SHARE_FIELD_OBJECT_KINDS,
    ...SHARE_VERIFICATION_KINDS.map((kind) => `${PEEK_VERIFICATION_PREFIX}${kind}`),
  ];
  const subtype = subtypes.find((candidate) => path.startsWith(`${candidate}.`));
  if (subtype === undefined) {
    return null;
  }
  const rest = path.slice(subtype.length + 1);
  const hasFields = (SHARE_FIELD_OBJECT_KINDS as readonly string[]).includes(subtype);
  if (hasFields && rest.startsWith(PEEK_FIELD_MARK)) {
    const fieldKey = rest.slice(PEEK_FIELD_MARK.length);
    return PEEK_FIELD_KEY.test(fieldKey) ? { subtype, fieldKey } : null;
  }
  return PEEK_ATTRIBUTE.test(rest) && rest !== 'fields' ? { subtype, fieldKey: null } : null;
}

/**
 * C230.3, Stage 1a amendment 26: whether a peek path lies inside what the policy shares: an
 * object's attribute when the policy shares that source type, an object's field when its
 * allowlist names the key, a verification's attribute when the policy lists that verification
 * type. The same rule as `storedSharePolicySchema`'s refinement.
 */
export function peekPathShared(policy: SharePolicyRules, path: string): boolean {
  const parts = peekPathParts(path);
  if (parts === null) {
    return false;
  }
  const { subtype, fieldKey } = parts;
  if (subtype.startsWith(PEEK_VERIFICATION_PREFIX)) {
    return (policy.verifications.types as readonly string[]).includes(
      subtype.slice(PEEK_VERIFICATION_PREFIX.length),
    );
  }
  const objectKind = subtype as ShareFieldObjectKind;
  return (
    policy['source-types'].includes(objectKind) &&
    (fieldKey === null || policy.fields[objectKind].includes(fieldKey))
  );
}

/** The visibility a peek serves at `path`: `full` only where the policy names a shared path so. */
export function peekVisibilityOf(policy: SharePolicyRules, path: string): SharePeekVisibility {
  return Object.hasOwn(policy.peek, path) &&
    policy.peek[path] === 'full' &&
    peekPathShared(policy, path)
    ? 'full'
    : 'presence';
}

export const SHARE_POLICY_RULES = Object.freeze([
  'selfie_needs_biometric',
  'verification_types_missing',
  'peek_paths_over_limit',
  'peek_path_not_shared',
] as const);
export type SharePolicyRule = (typeof SHARE_POLICY_RULES)[number];

/** One broken rule, at the JSON pointer of the member it is about (`~1` for a `/`). */
export interface SharePolicyProblem {
  readonly pointer: string;
  readonly rule: SharePolicyRule;
}

/** C230.3 (provisional, ours): at most 400 peek paths, as `SHARE_POLICY_LIMITS` says. */
const PEEK_PATHS_MAX = 400;

/** RFC 6901: `~` as `~0`, then `/` as `~1`. */
const pointerToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * C230.3: every rule a policy breaks (422 `share_policy_invalid`), in member order, each at the
 * JSON pointer of the member it is about, relative to the policy. The same rules and pointers as
 * `storedSharePolicySchema`'s refinement, for a caller that holds a parsed policy.
 */
export function sharePolicyProblems(policy: SharePolicyRules): SharePolicyProblem[] {
  const problems: SharePolicyProblem[] = [];
  const types = policy.verifications.types;
  const selfie = types.indexOf('selfie');
  if (selfie !== -1 && !policy.biometric) {
    problems.push({
      pointer: `/verifications/types/${String(selfie)}`,
      rule: 'selfie_needs_biometric',
    });
  }
  if (policy['source-types'].includes('verification') && types.length === 0) {
    problems.push({ pointer: '/verifications/types', rule: 'verification_types_missing' });
  }
  const paths = Object.keys(policy.peek);
  if (paths.length > PEEK_PATHS_MAX) {
    problems.push({ pointer: '/peek', rule: 'peek_paths_over_limit' });
  }
  for (const path of paths) {
    if (!peekPathShared(policy, path)) {
      problems.push({ pointer: `/peek/${pointerToken(path)}`, rule: 'peek_path_not_shared' });
    }
  }
  return problems;
}

/**
 * C230.3 (review P03): whether an attested source consent may authorise a share: never under
 * `none`, only a share without `biometric` under `non-biometric` (the default), any under `all`.
 */
export function attestedConsentAllows(
  mode: ShareAttestedConsent,
  carriesBiometric: boolean,
): boolean {
  switch (mode) {
    case 'none':
      return false;
    case 'non-biometric':
      return !carriesBiometric;
    case 'all':
      return true;
  }
}

/** What a token's source is, for {@link shareSourceRefusal}. */
export interface ShareSourceRef {
  readonly type: ShareSourceKind;
  /** A verification source's core type. */
  readonly verificationType?: string | undefined;
}

/**
 * C232.1: `share_source_not_allowed` when the policy does not share this source type, or, for a
 * verification, its type; else `null`. A report id never reaches here (`share_source_not_supported`
 * is the route's, by the id's prefix).
 */
export function shareSourceRefusal(
  policy: SharePolicyRules,
  source: ShareSourceRef,
): 'share_source_not_allowed' | null {
  if (!policy['source-types'].includes(source.type)) {
    return 'share_source_not_allowed';
  }
  if (source.type !== 'verification') {
    return null;
  }
  const kind =
    source.verificationType === undefined
      ? null
      : shareKindOfVerificationType(source.verificationType);
  return kind !== null && verificationKindShared(policy, kind) ? null : 'share_source_not_allowed';
}
