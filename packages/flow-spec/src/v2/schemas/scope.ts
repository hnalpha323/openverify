/**
 * C150.2, C150.10 (reviews P06, H20): what a branch condition may read, described path by path.
 * Each path names its value type, whether it can be unknown (`nullable`), its PII mark, the tier
 * and stage of the evidence behind it, and its source: `verification` (decided by a verification),
 * `server` (observed or computed by the server), `person` (typed or chosen by the person),
 * `client` (reported by the client software) or `operator` (set by the customer's server). Only
 * a verification's own `status`, `attempts` and `attempts-remaining` are its outcome (C150.7).
 *
 * The scope's JSON Schema for the builder (with `source` on every path) and its assembly on the
 * server are built from these descriptions by `flow-spec-logic` and `api-flow-engine`.
 */
import type { CheckStage, SignalTier } from '@openverify/core';
import { INQUIRY_STATUSES, VERIFICATION_STATUSES } from '@openverify/core';
import { DEVICE_KINDS, type VerificationStepType } from './steps.js';

export const SCOPE_SOURCES = ['verification', 'server', 'person', 'client', 'operator'] as const;
export type ScopeSource = (typeof SCOPE_SOURCES)[number];

export const SCOPE_VALUE_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'string-array',
] as const;
export type ScopeValueType = (typeof SCOPE_VALUE_TYPES)[number];

/** The roots of the flow scope (C150.2); `screen` is the visibility rules' own scope (C148.4). */
export const SCOPE_ROOTS = [
  'inquiry',
  'verifications',
  'account',
  'device',
  'signals',
  'lists',
  'workflows',
  'session',
  'screen',
] as const;
export type ScopeRoot = (typeof SCOPE_ROOTS)[number];

/** `device.platform` (C150.2): from the client's `User-Agent`; nullable. */
export const DEVICE_PLATFORMS = ['web', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** `workflows.<step id>.status` (C152.2): `timed-out` is ours, the run canceled at the timeout. */
export const FLOW_WORKFLOW_STATUSES = ['completed', 'errored', 'canceled', 'timed-out'] as const;

/** The check statuses a route reads; `pending` and an errored `not_applicable` read `null` (C150.2). */
export const SCOPE_CHECK_STATUSES = ['passed', 'failed', 'not_applicable'] as const;

/** One path of the scope. A segment in angle brackets (`<step id>`) is filled per flow. */
export interface ScopePathDescription {
  readonly path: string;
  readonly type: ScopeValueType;
  /** The closed vocabulary of an `enum` path. */
  readonly options?: readonly string[];
  /** Whether the path can read `null`, so a route reading it needs `onNull` (C150.3). */
  readonly nullable: boolean;
  /** PII: never compared with a literal (C114.5's `pii_literal_in_condition`). */
  readonly pii: boolean;
  /** The evidence's tier; `null` when its registry entry (a check or a signal) gives it. */
  readonly tier: SignalTier | null;
  /** `null` when its registry entry gives it. */
  readonly stage: CheckStage | null;
  readonly source: ScopeSource;
  /** A verification outcome (C150.7): its own status and attempts, nothing else. */
  readonly outcome: boolean;
  /** Refused in flows at publish (`scope_path_unavailable_in_flow`; C150.2, C150.9). */
  readonly availableInFlow: boolean | 'flow-provisional-only';
}

/** An extracted value a verification step exposes as `verifications.<step id>.<attribute>`. */
export interface FlowScopeExtraction {
  readonly attribute: string;
  readonly type: ScopeValueType;
  readonly options?: readonly string[];
  readonly pii: boolean;
  readonly tier: SignalTier;
  readonly stage: CheckStage;
}

/** A description of a whole scope at one node: what the builder and the typing read. */
export interface ScopeDescription {
  readonly paths: readonly ScopePathDescription[];
}

const extraction = (
  attribute: string,
  type: ScopeValueType,
  pii: boolean,
  tier: SignalTier,
  stage: CheckStage,
  options?: readonly string[],
): FlowScopeExtraction =>
  Object.freeze({
    attribute,
    type,
    pii,
    tier,
    stage,
    ...(options === undefined ? {} : { options }),
  });

/**
 * C150.2: the extracted values each verification type exposes. Extractions read from a document by
 * OCR, MRZ or a barcode and classified by a model are `R/H` and `beta` (ADR 0002): a route on one
 * needs `heuristic:<step id>` (C150.7). Values that identify the person are PII; the country and
 * the document's class are not, so a route can compare them with a literal (the public "country
 * select with branching" module).
 */
export const FLOW_SCOPE_EXTRACTIONS: Readonly<
  Record<VerificationStepType, readonly FlowScopeExtraction[]>
> = Object.freeze({
  government_id: Object.freeze([
    extraction('country-code', 'string', false, 'R/H', 'beta'),
    extraction('id-class', 'string', false, 'R/H', 'beta'),
    extraction('birthdate', 'date', true, 'R/H', 'beta'),
    extraction('age-years', 'integer', true, 'R/H', 'beta'),
    extraction('expiration-date', 'date', true, 'R/H', 'beta'),
  ]),
  selfie: Object.freeze([]),
  document: Object.freeze([extraction('document-type', 'string', false, 'H', 'beta')]),
  phone_otp: Object.freeze([]),
  email_otp: Object.freeze([]),
  database: Object.freeze([]),
  aamva: Object.freeze([]),
  nfc: Object.freeze([]),
  crypto_wallet: Object.freeze([]),
  database_business: Object.freeze([]),
  business_website: Object.freeze([]),
});

const path = (
  description: Omit<ScopePathDescription, 'outcome' | 'availableInFlow'> &
    Partial<Pick<ScopePathDescription, 'outcome' | 'availableInFlow'>>,
): ScopePathDescription => Object.freeze({ outcome: false, availableInFlow: true, ...description });

/**
 * C150.2: every fixed path of the scope, with its description. Template paths: `<key>` a
 * template field (typed by `field-schemas`, PII as marked), `<step id>` a step of the flow (a step
 * that does not dominate the branch reads nullable), `<check>` a check name (tier and stage from
 * the check registry), `<attribute>` an entry of `FLOW_SCOPE_EXTRACTIONS`, `<name>` a signal of
 * the registry (only `flowProvisional` ones, through their snapshot) or a workflow output (typed by
 * the version's output mappings), `<list id>` a list.
 */
export const FLOW_SCOPE_PATHS: readonly ScopePathDescription[] = Object.freeze([
  path({
    path: 'inquiry.status',
    type: 'enum',
    options: INQUIRY_STATUSES,
    nullable: false,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'inquiry.fields.<key>',
    type: 'string',
    nullable: true,
    pii: true,
    tier: 'R',
    stage: 'ga',
    source: 'person',
  }),
  path({
    path: 'inquiry.tags',
    type: 'string-array',
    nullable: false,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'operator',
  }),
  path({
    path: 'inquiry.created-at',
    type: 'datetime',
    nullable: false,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'inquiry.started-at',
    type: 'datetime',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'verifications.<step id>.status',
    type: 'enum',
    options: VERIFICATION_STATUSES,
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'verification',
    outcome: true,
  }),
  path({
    path: 'verifications.<step id>.attempts',
    type: 'integer',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'verification',
    outcome: true,
  }),
  path({
    path: 'verifications.<step id>.attempts-remaining',
    type: 'integer',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'verification',
    outcome: true,
  }),
  path({
    path: 'verifications.<step id>.checks.<check>.status',
    type: 'enum',
    options: SCOPE_CHECK_STATUSES,
    nullable: true,
    pii: false,
    tier: null,
    stage: null,
    source: 'verification',
  }),
  path({
    path: 'verifications.<step id>.<attribute>',
    type: 'string',
    nullable: true,
    pii: true,
    tier: null,
    stage: null,
    source: 'verification',
  }),
  path({
    path: 'account.account-type-id',
    type: 'string',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'account.status',
    type: 'string',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'account.tags',
    type: 'string-array',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'operator',
  }),
  path({
    path: 'device.kind',
    type: 'enum',
    options: DEVICE_KINDS,
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'client',
  }),
  path({
    path: 'device.platform',
    type: 'enum',
    options: DEVICE_PLATFORMS,
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'client',
  }),
  path({
    path: 'signals.<name>',
    type: 'string',
    nullable: true,
    pii: false,
    tier: null,
    stage: null,
    source: 'server',
    availableInFlow: 'flow-provisional-only',
  }),
  path({
    path: 'lists.<list id>.matched',
    type: 'boolean',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
    availableInFlow: false,
  }),
  path({
    path: 'workflows.<step id>.status',
    type: 'enum',
    options: FLOW_WORKFLOW_STATUSES,
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'workflows.<step id>.error-type',
    type: 'string',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'workflows.<step id>.outputs.<name>',
    type: 'string',
    nullable: true,
    pii: true,
    tier: null,
    stage: null,
    source: 'server',
  }),
  path({
    path: 'session.locale',
    type: 'string',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'client',
  }),
  path({
    path: 'session.resumed',
    type: 'boolean',
    nullable: false,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
  path({
    path: 'session.handoff.state',
    type: 'string',
    nullable: true,
    pii: false,
    tier: 'R',
    stage: 'ga',
    source: 'server',
  }),
]);
