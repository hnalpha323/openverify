/**
 * Report types (plan C69.1): one entry per type with its tier, stage, whether it recurs, its
 * review model, the source kind it screens and the provider kinds it needs. The query and result
 * schemas, the golden fixtures and the dashboard labels live where their layer is (contracts,
 * `contracts/fixtures/api/report-<type>.json`, the dashboard's `lib/labels.ts`); a test in each
 * layer walks {@link REPORT_TYPES}, so a new type fails until every layer has it.
 */
import { z } from 'zod';
import type { CheckStage } from './enums.js';

/** C69.1: the nine Phase 6 report types, in the plan's order, then Phase 7's (C106). */
export const REPORT_TYPES = Object.freeze([
  'watchlist',
  'business-watchlist',
  'crypto-address-watchlist',
  'politically-exposed-person',
  'adverse-media',
  'business-adverse-media',
  'email-address',
  'phone-number',
  'address-lookup',
  // C106.1 (Phase 7, Workflow 7A): the network facts of one address.
  'ip-address',
  // C106.2 (Phase 7, Workflow 7B): the operator's own lists.
  'custom-list',
] as const);
export const reportTypeSchema = z.enum(REPORT_TYPES);
export type ReportType = z.infer<typeof reportTypeSchema>;

/** `report/<type>`: the JSON:API type of a report (C70). */
export type ReportResourceType = `report/${ReportType}`;

/** ADR 0002's tiers, which a report type combines (C69.1). */
export const REPORT_TIERS = ['R', 'H', 'A'] as const;
export type ReportTier = (typeof REPORT_TIERS)[number];

/** How a type's results are reviewed: match by match (C75), or not at all. */
export const REPORT_REVIEW_MODELS = ['matches', 'none'] as const;
export type ReportReviewModel = (typeof REPORT_REVIEW_MODELS)[number];

/** The kind of watchlist source a matching type screens (C76.1). */
export const WATCHLIST_SOURCE_KINDS = ['sanctions', 'pep'] as const;
export type WatchlistSourceKind = (typeof WATCHLIST_SOURCE_KINDS)[number];

/** C83: the provider kinds Phase 6 adds, then Phase 7's `ipReputation` (C93.5, a C83 amendment). */
export const REPORT_PROVIDER_KINDS = [
  'adverseMedia',
  'emailIntelligence',
  'phoneIntelligence',
  'addressVerification',
  'cryptoExposure',
  'ipReputation',
] as const;
export type ReportProviderKind = (typeof REPORT_PROVIDER_KINDS)[number];

/**
 * C70.4: the action of a report event, `report/<type>.<action>`. `.submitted` is reserved for
 * parity and not registered (decision 3).
 */
export const REPORT_EVENT_ACTIONS = [
  'ready',
  'errored',
  'matched',
  'dismissed',
  'reviewed',
  'redacted',
] as const;
export type ReportEventAction = (typeof REPORT_EVENT_ACTIONS)[number];
export type ReportEventName = `${ReportResourceType}.${ReportEventAction}`;

export interface ReportTypeDefinition {
  readonly type: ReportType;
  readonly resourceType: ReportResourceType;
  /** The tiers the type combines, R first (ADR 0002 §1). */
  readonly tiers: readonly ReportTier[];
  /** Which part of the answer each tier covers, in the plan's words (C69.1). */
  readonly tierNote: string;
  readonly stage: CheckStage;
  /** What would promote the type to `ga` (ADR 0002 §3f). */
  readonly gaCondition: string;
  /** Whether a template may schedule it and `POST /reports/:id/run` re-runs it (C74.5). */
  readonly recurrable: boolean;
  readonly review: ReportReviewModel;
  /** The kind of watchlist source it screens, or `null` for a type without lists. */
  readonly sourceKind: WatchlistSourceKind | null;
  /** The sources must carry crypto addresses (C79.3). */
  readonly needsCryptoAddresses: boolean;
  /** A provider without which the whole answer is `provider_not_configured` (C69.4). */
  readonly requiredProviderKind: ReportProviderKind | null;
  /** Providers that fill some fields; unbound, those fields are null (C69.4). */
  readonly optionalProviderKinds: readonly ReportProviderKind[];
  /** The type asks DNS (C82.1). */
  readonly usesDns: boolean;
  /** The events the type emits, in {@link REPORT_EVENT_ACTIONS} order (C70.4). */
  readonly events: readonly ReportEventAction[];
}

const MATCH_EVENTS: readonly ReportEventAction[] = Object.freeze([...REPORT_EVENT_ACTIONS]);
const PLAIN_EVENTS: readonly ReportEventAction[] = Object.freeze(['ready', 'errored', 'redacted']);

/** H-tier results stay beta until a calibration report and review (ADR 0002 §3f). */
const CALIBRATION =
  'a calibration report on the held-out synthetic set (C78.8, ADR 0002 §3f) and review';

type Entry = Omit<ReportTypeDefinition, 'type' | 'resourceType' | 'events'>;

function entry(type: ReportType, fields: Entry): ReportTypeDefinition {
  return Object.freeze({
    type,
    resourceType: toReportResourceType(type),
    ...fields,
    tiers: Object.freeze([...fields.tiers]),
    optionalProviderKinds: Object.freeze([...fields.optionalProviderKinds]),
    events: fields.review === 'matches' ? MATCH_EVENTS : PLAIN_EVENTS,
  });
}

const SCREENING = {
  stage: 'beta',
  recurrable: true,
  review: 'matches',
  needsCryptoAddresses: false,
  requiredProviderKind: null,
  optionalProviderKinds: [],
  usesDns: false,
} as const;

const RISK = {
  stage: 'beta',
  recurrable: false,
  review: 'none',
  sourceKind: null,
  needsCryptoAddresses: false,
  requiredProviderKind: null,
  usesDns: false,
} as const;

/** C69.1: every report type's entry. */
export const REPORT_REGISTRY: Readonly<Record<ReportType, ReportTypeDefinition>> = Object.freeze({
  watchlist: entry('watchlist', {
    ...SCREENING,
    tiers: ['R', 'H'],
    tierNote: 'R lists (parsing, versioning, normalisation), H name score',
    gaCondition: CALIBRATION,
    sourceKind: 'sanctions',
  }),
  'business-watchlist': entry('business-watchlist', {
    ...SCREENING,
    tiers: ['R', 'H'],
    tierNote: 'R lists and exact identifiers, H name score',
    gaCondition: CALIBRATION,
    sourceKind: 'sanctions',
  }),
  'crypto-address-watchlist': entry('crypto-address-watchlist', {
    ...SCREENING,
    // C69.1 (Stage 1a amendment 11): the vectors of every C79.3 row pass
    // (packages/watchlist/src/crypto/canonical.test.ts), and matching is exact only.
    stage: 'ga',
    tiers: ['R'],
    tierNote: 'R exact match on canonical addresses; the optional exposure block is A',
    gaCondition:
      'the test vectors of every row of the C79.3 format table pass (C69.1); exact matching only',
    sourceKind: 'sanctions',
    needsCryptoAddresses: true,
    optionalProviderKinds: ['cryptoExposure'],
  }),
  'politically-exposed-person': entry('politically-exposed-person', {
    ...SCREENING,
    tiers: ['H'],
    tierNote: 'H: PEP status from Wikidata positions held, with a coverage notice',
    gaCondition: CALIBRATION,
    sourceKind: 'pep',
  }),
  'adverse-media': entry('adverse-media', {
    ...SCREENING,
    tiers: ['H', 'A'],
    tierNote: 'A articles from the adverseMedia provider, H relevance from titles',
    gaCondition: CALIBRATION,
    sourceKind: null,
    requiredProviderKind: 'adverseMedia',
  }),
  'business-adverse-media': entry('business-adverse-media', {
    ...SCREENING,
    tiers: ['H', 'A'],
    tierNote: 'A articles from the adverseMedia provider, H relevance from titles',
    gaCondition: CALIBRATION,
    sourceKind: null,
    requiredProviderKind: 'adverseMedia',
  }),
  'email-address': entry('email-address', {
    ...RISK,
    tiers: ['R', 'H', 'A'],
    tierNote: 'R DNS and list facts, H reputation band, A breach exposure',
    gaCondition: CALIBRATION,
    optionalProviderKinds: ['emailIntelligence'],
    usesDns: true,
  }),
  'phone-number': entry('phone-number', {
    ...RISK,
    tiers: ['R', 'H', 'A'],
    tierNote: 'R numbering plan, H risk level, A carrier, line type and SIM swap',
    gaCondition: CALIBRATION,
    optionalProviderKinds: ['phoneIntelligence'],
  }),
  'address-lookup': entry('address-lookup', {
    ...RISK,
    tiers: ['R', 'A'],
    tierNote: 'R normalisation and postal checks, A postal verification',
    gaCondition:
      'R fields are exact; the A fields come from the bound provider and are never promoted here',
    optionalProviderKinds: ['addressVerification'],
  }),
  // C106.1 (Phase 7; H01, H07, F04, F05): review model none, so has-match is always false and
  // the events are ready, errored and redacted. R for Tor, provider ranges, geolocation and ASN;
  // H for the VPN and hosting-ASN flags; A for the proxy flag (the optional ipReputation adapter).
  'ip-address': entry('ip-address', {
    ...RISK,
    tiers: ['R', 'H', 'A'],
    tierNote:
      'R Tor exits, provider ranges, country, region and ASN; H the VPN and hosting-ASN flags; A the proxy flag',
    gaCondition: CALIBRATION,
    optionalProviderKinds: ['ipReputation'],
  }),
  // C106.2 (Phase 7; H08, F04): review model matches, so the six derived events apply. It screens
  // the operator's lists, not a watchlist source (`sourceKind: null`); each match carries the tier
  // of its own evidence (C99.1). An unscreened list ends the run errored, keeping its matches.
  'custom-list': entry('custom-list', {
    ...SCREENING,
    tiers: ['R', 'H'],
    tierNote:
      'R exact, CIDR and radius matches on R-tier probes; H fuzzy names, backgrounds and IP-derived probes',
    gaCondition: CALIBRATION,
    sourceKind: null,
  }),
});

/** `report/<type>`. */
export function toReportResourceType(type: ReportType): ReportResourceType {
  return `report/${type}`;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(REPORT_TYPES);

/** Whether `value` is a report type. */
export function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && KNOWN_TYPES.has(value);
}

/** The report type of `report/<type>`, or `null` for any other value. */
export function fromReportResourceType(value: string): ReportType | null {
  if (!value.startsWith('report/')) {
    return null;
  }
  const type = value.slice('report/'.length);
  return isReportType(type) ? type : null;
}

/** The registry entry of a type. */
export function getReportTypeDefinition(type: ReportType): ReportTypeDefinition {
  return REPORT_REGISTRY[type];
}

/** `report/<type>.<action>` (C70.4). */
export function reportEventName(type: ReportType, action: ReportEventAction): ReportEventName {
  return `report/${type}.${action}`;
}

/** Every report event name: the types in {@link REPORT_TYPES} order, each type's actions in order. */
export const REPORT_EVENT_NAMES: readonly ReportEventName[] = Object.freeze(
  REPORT_TYPES.flatMap((type) =>
    REPORT_REGISTRY[type].events.map((action) => reportEventName(type, action)),
  ),
);
