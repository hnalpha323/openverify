/**
 * C233.2, C233.3 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 2): the peek's
 * `source-data`, built from the share content the policy lets through ({@link shareableContent}):
 * every exposed attribute is `{visibility, value}`, where `presence` carries only whether the source
 * holds a non-null value; an attribute the policy does not share is absent. Its shape is
 * `@openverify/contracts`' `sourceDataSchema` (`api-connect` parses every answer with it).
 */
import {
  FILE_KINDS_OF_SHARE_KIND,
  shareableContent,
  type ShareFieldEntry,
  type ShareSourceContent,
  type SharedObject,
  type SharedVerification,
} from './content.js';
import { peekVisibilityOf, type SharePolicyRules, type ShareVerificationKind } from './policy.js';

/** C233.2: one exposed attribute. */
export type PeekAttributeValue =
  | { readonly visibility: 'full'; readonly value: unknown }
  | { readonly visibility: 'presence'; readonly value: boolean };

/** C233.3: a file is at most "the source holds one". */
export interface PeekFilePresence {
  readonly visibility: 'presence';
  readonly value: boolean;
}

/** A verification's envelope, alone (a verification source) or in an inquiry's `related-objects`. */
export interface SourceDataVerificationEnvelope {
  readonly type: `connect/source-data/verification/${ShareVerificationKind}`;
  readonly attributes: Readonly<Record<string, PeekAttributeValue>>;
  readonly files?: PeekFilePresence;
}

/** C233.2: `source-data`, by subtype. */
export type SourceDataEnvelope =
  | {
      readonly type: 'connect/source-data/inquiry';
      readonly attributes: Readonly<Record<string, PeekAttributeValue>>;
      readonly fields: Readonly<Record<string, PeekAttributeValue>>;
      readonly 'related-objects': readonly SourceDataVerificationEnvelope[];
    }
  | {
      readonly type: 'connect/source-data/account' | 'connect/source-data/transaction';
      readonly attributes: Readonly<Record<string, PeekAttributeValue>>;
      readonly fields: Readonly<Record<string, PeekAttributeValue>>;
    }
  | SourceDataVerificationEnvelope;

/** C233.2, C234.9: at most 50 related objects (the redemption's verification limit). */
export const SOURCE_DATA_RELATED_OBJECTS_MAX = 50;

/** The names an envelope can hold (`sourceDataSchema`'s record keys). */
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const FIELD_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** The field types that hold a file: present at most (C233.3). */
const FILE_FIELD_TYPES: ReadonlySet<string> = new Set(['file', 'platform-file']);

const presenceOf = (value: unknown): PeekAttributeValue => ({
  visibility: 'presence',
  value: value !== null && value !== undefined,
});

/** One attribute at `path`: its value where the policy names the path `full`, else its presence. */
function exposed(policy: SharePolicyRules, path: string, value: unknown): PeekAttributeValue {
  return peekVisibilityOf(policy, path) === 'full'
    ? { visibility: 'full', value: value ?? null }
    : presenceOf(value);
}

function objectAttributes(
  policy: SharePolicyRules,
  subtype: string,
  object: SharedObject,
): Record<string, PeekAttributeValue> {
  return Object.fromEntries(
    Object.entries(object.base)
      .filter(([name]) => ATTRIBUTE_NAME.test(name))
      .map(([name, value]) => [name, exposed(policy, `${subtype}.${name}`, value)]),
  );
}

function objectFields(
  policy: SharePolicyRules,
  subtype: string,
  fields: readonly ShareFieldEntry[],
): Record<string, PeekAttributeValue> {
  return Object.fromEntries(
    fields
      .filter((entry) => FIELD_KEY.test(entry.key))
      .map((entry) => [
        entry.key,
        FILE_FIELD_TYPES.has(entry.type)
          ? presenceOf(entry.value)
          : exposed(policy, `${subtype}.fields.${entry.key}`, entry.value),
      ]),
  );
}

/**
 * A verification's envelope: its base attributes, its extracted data and its checks (as the one
 * attribute `checks`, `[{name, status}]`) where the policy shares them, and `files` as a presence
 * only where the policy shares files of a type that holds any. A selfie's own attributes (scores,
 * the face's coordinates) describe the face, so they are present at most (C233.3); its status and
 * its checks follow the policy's peek entries, `biometric` being on (C230.3).
 */
function verificationEnvelope(
  policy: SharePolicyRules,
  verification: SharedVerification,
): SourceDataVerificationEnvelope {
  const subtype = `verification/${verification.kind}` as const;
  const attributes: Record<string, PeekAttributeValue> = {};
  for (const [name, value] of Object.entries(verification.base)) {
    if (ATTRIBUTE_NAME.test(name)) {
      attributes[name] = exposed(policy, `${subtype}.${name}`, value);
    }
  }
  for (const [name, value] of Object.entries(verification.extracted)) {
    if (ATTRIBUTE_NAME.test(name)) {
      attributes[name] =
        verification.kind === 'selfie'
          ? presenceOf(value)
          : exposed(policy, `${subtype}.${name}`, value);
    }
  }
  if (policy.verifications['check-results']) {
    const checks = verification.checks.map(({ name, status }) => ({ name, status }));
    attributes.checks =
      peekVisibilityOf(policy, `${subtype}.checks`) === 'full'
        ? { visibility: 'full', value: checks }
        : { visibility: 'presence', value: checks.length > 0 };
  }
  const holdsFiles = FILE_KINDS_OF_SHARE_KIND[verification.kind].length > 0;
  return {
    type: `connect/source-data/${subtype}`,
    attributes,
    ...(policy.verifications.files && holdsFiles
      ? { files: { visibility: 'presence', value: verification.files.length > 0 } as const }
      : {}),
  };
}

/**
 * C233.2, C233.3: the peek of `content` under `policy`, or `null` when the policy does not share the
 * source. Built from {@link shareableContent}, so an attribute the policy does not share is absent;
 * a shared one is `{visibility: 'full', value}` only where the policy's `peek` names its path
 * `full` (Stage 1a amendment 26's grammar), else `{visibility: 'presence', value}` with whether the
 * source holds a non-null value. Never in a peek: a file's bytes or id (a file field and a
 * verification's files are a presence at most), an image, a selfie's face data, a face template. An
 * inquiry's `related-objects` are its first {@link SOURCE_DATA_RELATED_OBJECTS_MAX} shareable
 * verifications, as many as a redemption may copy (C234.9).
 */
export function sourceDataOf(
  policy: SharePolicyRules,
  content: ShareSourceContent,
): SourceDataEnvelope | null {
  const shared = shareableContent(policy, content);
  if (shared === null) {
    return null;
  }
  switch (shared.type) {
    case 'verification':
      return verificationEnvelope(policy, shared.verification);
    case 'inquiry':
      return {
        type: 'connect/source-data/inquiry',
        attributes: objectAttributes(policy, 'inquiry', shared.object),
        fields: objectFields(policy, 'inquiry', shared.object.fields),
        'related-objects': shared.verifications
          .slice(0, SOURCE_DATA_RELATED_OBJECTS_MAX)
          .map((verification) => verificationEnvelope(policy, verification)),
      };
    case 'account':
    case 'transaction':
      return {
        type: `connect/source-data/${shared.type}`,
        attributes: objectAttributes(policy, shared.type, shared.object),
        fields: objectFields(policy, shared.type, shared.object.fields),
      };
  }
}
