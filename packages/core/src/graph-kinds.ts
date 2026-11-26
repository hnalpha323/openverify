/**
 * The account graph's property kinds (plan C101.2), a frozen enum. C101.2 calls it "a frozen enum
 * in contracts", which cannot work: `packages/db` stores the code and `packages/checks` keys the
 * value, and neither can read contracts (owner decision 14 after Workflow 7A). So it lives here and
 * contracts re-exports it. The public node type names are snake case (H19); `kind smallint` holds
 * {@link GraphKindDefinition.code}, which never changes once written.
 */
import { z } from 'zod';

export const GRAPH_KINDS = [
  'government_id_number',
  'chip_signature',
  'crypto_address',
  'email_address',
  'phone_number',
  'email_address_unconfirmed',
  'phone_number_unconfirmed',
  'reference_id',
  'name_birthdate',
  'address',
  'device_fingerprint',
  'device_class',
  'browser_fingerprint',
  'ip_address',
  'name',
  'birthdate',
  'postal_code',
  'email_domain',
] as const;
export const graphKindSchema = z.enum(GRAPH_KINDS);
export type GraphKind = z.infer<typeof graphKindSchema>;

/** C101.2: strength drives traversal. Weak kinds are written and traversed only on opt-in. */
export const GRAPH_STRENGTHS = ['strong', 'medium', 'weak'] as const;
export type GraphStrength = (typeof GRAPH_STRENGTHS)[number];

/** Which key a kind's `value_key` is: a labelled identifier, or an existing C31.8 or C53 index. */
export type GraphKeySource =
  | 'existing-index'
  | 'identifier-email'
  | 'identifier-phone'
  | 'identifier-reference-id'
  | 'identifier-name-birthdate'
  | 'identifier-address'
  | 'identifier-device-fingerprint'
  | 'identifier-browser-fingerprint'
  | 'identifier-ip'
  | 'identifier-name'
  | 'identifier-birthdate'
  | 'identifier-postal-code'
  | 'identifier-email-domain';

export interface GraphKindDefinition {
  readonly kind: GraphKind;
  /** `graph_attributes.kind`, `smallint`: frozen once written. */
  readonly code: number;
  readonly strength: GraphStrength;
  readonly key: GraphKeySource;
  /** C102.4 (P11): a parameter of this kind identifies a person, so it needs `pii:view`. */
  readonly identifiesPerson: boolean;
  /** C101.3: written only for sessions under the device-recognition tier. */
  readonly needsDeviceRecognition: boolean;
}

function kind(
  name: GraphKind,
  code: number,
  strength: GraphStrength,
  key: GraphKeySource,
  options: Partial<Pick<GraphKindDefinition, 'identifiesPerson' | 'needsDeviceRecognition'>> = {},
): GraphKindDefinition {
  return Object.freeze({
    kind: name,
    code,
    strength,
    key,
    identifiesPerson: false,
    needsDeviceRecognition: false,
    ...options,
  });
}

const PERSON = { identifiesPerson: true } as const;
const DEVICE = { needsDeviceRecognition: true } as const;

/**
 * C101.2. The labels are shared with the lists (decision 29, narrowed): the graph's
 * `government_id_number`, `chip_signature` and `crypto_address` keep their existing indexes.
 */
export const GRAPH_KIND_REGISTRY: Readonly<Record<GraphKind, GraphKindDefinition>> = Object.freeze({
  government_id_number: kind('government_id_number', 1, 'strong', 'existing-index', PERSON),
  chip_signature: kind('chip_signature', 2, 'strong', 'existing-index'),
  crypto_address: kind('crypto_address', 3, 'strong', 'existing-index'),
  email_address: kind('email_address', 4, 'strong', 'identifier-email', PERSON),
  phone_number: kind('phone_number', 5, 'strong', 'identifier-phone', PERSON),
  email_address_unconfirmed: kind(
    'email_address_unconfirmed',
    6,
    'medium',
    'identifier-email',
    PERSON,
  ),
  phone_number_unconfirmed: kind(
    'phone_number_unconfirmed',
    7,
    'medium',
    'identifier-phone',
    PERSON,
  ),
  reference_id: kind('reference_id', 8, 'strong', 'identifier-reference-id', PERSON),
  name_birthdate: kind('name_birthdate', 9, 'medium', 'identifier-name-birthdate', PERSON),
  address: kind('address', 10, 'medium', 'identifier-address', PERSON),
  device_fingerprint: kind(
    'device_fingerprint',
    11,
    'medium',
    'identifier-device-fingerprint',
    DEVICE,
  ),
  // F24: every user of one phone model shares it. Same label as `device_fingerprint`; the `kind`
  // column keeps the rows apart (Stage 1a amendment 3).
  device_class: kind('device_class', 12, 'weak', 'identifier-device-fingerprint', DEVICE),
  browser_fingerprint: kind(
    'browser_fingerprint',
    13,
    'weak',
    'identifier-browser-fingerprint',
    DEVICE,
  ),
  ip_address: kind('ip_address', 14, 'weak', 'identifier-ip'),
  name: kind('name', 15, 'weak', 'identifier-name', PERSON),
  birthdate: kind('birthdate', 16, 'weak', 'identifier-birthdate'),
  postal_code: kind('postal_code', 17, 'weak', 'identifier-postal-code'),
  email_domain: kind('email_domain', 18, 'weak', 'identifier-email-domain'),
});

/** The kinds a template may traverse without opting in to weak ones (C102.2). */
export const GRAPH_WEAK_KINDS: readonly GraphKind[] = Object.freeze(
  GRAPH_KINDS.filter((name) => GRAPH_KIND_REGISTRY[name].strength === 'weak'),
);

/** C101.6: only strong kinds enter components: IP links alone merged a million accounts into one. */
export const GRAPH_STRONG_KINDS: readonly GraphKind[] = Object.freeze(
  GRAPH_KINDS.filter((name) => GRAPH_KIND_REGISTRY[name].strength === 'strong'),
);

/** C102.4 (P11): the kinds whose parameter needs `pii:view`. */
export const GRAPH_PERSON_KINDS: readonly GraphKind[] = Object.freeze(
  GRAPH_KINDS.filter((name) => GRAPH_KIND_REGISTRY[name].identifiesPerson),
);

/** The `graph_attributes.kind` code of `name`. */
export function graphKindCode(name: GraphKind): number {
  return GRAPH_KIND_REGISTRY[name].code;
}

const KIND_BY_CODE: ReadonlyMap<number, GraphKind> = new Map(
  GRAPH_KINDS.map((name) => [GRAPH_KIND_REGISTRY[name].code, name]),
);

/** The kind of a stored code, or `null` for one this build does not know. */
export function graphKindOfCode(code: number): GraphKind | null {
  return KIND_BY_CODE.get(code) ?? null;
}
