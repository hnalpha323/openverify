/**
 * C82.2: the `phone-number` report's R and H fields, as a pure function over the number and, when
 * bound, the `phoneIntelligence` provider's answer.
 *
 * - **R (libphonenumber-js `/max`, C55.8).** Possible and valid; the region; the numbering plan's
 *   type, mapped onto the public `phone-type` vocabulary without inventing a network answer:
 *   `PREMIUM_RATE`, `SHARED_COST` and `UAN` are `RESTRICTED_PREMIUM`, `PERSONAL_NUMBER` is
 *   `PERSONAL`, and `FIXED_LINE_OR_MOBILE` (every ordinary US and Canadian number) is `null`, kept
 *   in `phone-type-numbering-plan` and named `line_type_undetermined`: in the public vocabulary
 *   `OTHER` is a carrier's answer, which a plan cannot give. `PREPAID`, `PAYPHONE` and `OTHER` come
 *   only from a provider. A bound provider's network line type replaces the plan's type.
 * - **H (`beta`), the risk table** (`phone-risk-level` / `-recommendation`, with a confidence):
 *
 *   | Type | Level / recommendation | Confidence |
 *   |---|---|---|
 *   | `INVALID` | `high` / `block` | 0.95 |
 *   | `RESTRICTED_PREMIUM`, `TOLL_FREE`, `PAGER`, `VOICEMAIL` | `high` / `block` | 0.9 |
 *   | `VOIP` | `medium-high` / `block` | 0.7 |
 *   | `PREPAID`, `PAYPHONE` (provider only; owner decision 14) | `medium` / `flag` | 0.4 |
 *   | `PERSONAL` | `medium-low` / `allow` | 0.5 |
 *   | `MOBILE`, `FIXED_LINE` | `low` / `allow` | 0.5 |
 *   | undetermined (`FIXED_LINE_OR_MOBILE`, no provider) | `low` / `allow` (decision 51) | 0.3 |
 *
 *   With a provider, a SIM swap within 24 h gives `high` (0.8), within 7 days `medium-high` (0.6),
 *   a port within 30 days `medium` (0.4); the level is the worst reached, the recommendation the
 *   level's (low and medium-low allow, medium flags, medium-high and high block). `OTHER` (a
 *   provider's answer) is stated as `other_line_type` and adds no level; it, a valid number
 *   without a plan type, or a provider that failed, leaves the level `null` unless `high` is
 *   already reached (a SIM swap within 24 h), since the unread part could reach a worse one.
 *   `phone-risk-score` is never synthesised (decision 20).
 */
import type { CheckProvider } from '@openverify/core';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { ProviderOutcome } from '../../government-id/inputs.js';
import {
  riskConstant,
  type ContactConfirmation,
  type RiskConstantName,
  type RiskUnavailableReason,
  type UnavailableField,
} from '../constants.js';

/** `phone-type`: the public line types (the contracts' `PHONE_TYPES`). */
export const PHONE_LINE_TYPES = [
  'FIXED_LINE',
  'MOBILE',
  'PREPAID',
  'TOLL_FREE',
  'VOIP',
  'PAGER',
  'PAYPHONE',
  'INVALID',
  'RESTRICTED_PREMIUM',
  'PERSONAL',
  'VOICEMAIL',
  'OTHER',
] as const;
export type PhoneLineType = (typeof PHONE_LINE_TYPES)[number];

/** `phone-type-numbering-plan`: libphonenumber's types (the contracts' list). */
export const NUMBERING_PLAN_TYPES = [
  'FIXED_LINE',
  'MOBILE',
  'FIXED_LINE_OR_MOBILE',
  'TOLL_FREE',
  'PREMIUM_RATE',
  'SHARED_COST',
  'VOIP',
  'PERSONAL_NUMBER',
  'PAGER',
  'UAN',
  'VOICEMAIL',
] as const;
export type NumberingPlanType = (typeof NUMBERING_PLAN_TYPES)[number];

/** A provider's network line type (Twilio Lookup v2's names, plus `prepaid`, `payphone`, `other`). */
export const NETWORK_LINE_TYPES = [
  'landline',
  'mobile',
  'fixedVoip',
  'nonFixedVoip',
  'personal',
  'tollFree',
  'premium',
  'sharedCost',
  'uan',
  'voicemail',
  'pager',
  'prepaid',
  'payphone',
  'other',
  'unknown',
] as const;
export type NetworkLineType = (typeof NETWORK_LINE_TYPES)[number];

/** `phone-risk-level`, from the least to the most risky. */
export const PHONE_RISK_LEVELS = ['low', 'medium-low', 'medium', 'medium-high', 'high'] as const;
export type PhoneRiskLevel = (typeof PHONE_RISK_LEVELS)[number];

/** `phone-risk-recommendation`. */
export type PhoneRiskRecommendation = 'allow' | 'flag' | 'block';

/** Why the level is what it is (the contracts' `PHONE_RISK_REASONS`, in order). */
export const PHONE_LEVEL_REASONS = [
  'invalid_number',
  'high_risk_type',
  'voip',
  'prepaid',
  'payphone',
  'personal_number',
  'low_risk_type',
  'line_type_undetermined',
  'other_line_type',
  'sim_swap_24h',
  'sim_swap_7d',
  'ported_30d',
] as const;
export type PhoneLevelReason = (typeof PHONE_LEVEL_REASONS)[number];

/** `phone-risk-sim-swap`. */
export const SIM_SWAP_LEVELS = ['very-low', 'low', 'medium', 'high', 'N/A'] as const;
export type SimSwapLevel = (typeof SIM_SWAP_LEVELS)[number];

/** What a bound `phoneIntelligence` provider answered. */
export interface PhoneIntelligenceLookup {
  /** The network line type, or `null` when the provider gave none. */
  readonly lineType: NetworkLineType | null;
  /** The current carrier's name. */
  readonly carrier: string | null;
  /**
   * The SIM swap package: `checked: false` when it was not asked or not available; `lastSwapAt`
   * `null` when the provider knows of no swap (it must look back at least 30 days to say so).
   */
  readonly simSwap:
    { readonly checked: false } | { readonly checked: true; readonly lastSwapAt: Date | null };
  /** Porting, as SIM swap. */
  readonly porting:
    { readonly checked: false } | { readonly checked: true; readonly lastPortedAt: Date | null };
}

/** What the job passes. */
export interface PhoneNumberReportInput {
  /** The query's `phone-number`, in E.164. */
  readonly phoneNumber: string;
  readonly now: Date;
  /** The provider's answer; absent or `not_configured` when unbound. */
  readonly provider?: ProviderOutcome<PhoneIntelligenceLookup> | undefined;
  readonly confirmation: ContactConfirmation;
}

/** The type's fields, as `phoneNumberReportResourceSchema` names them. */
export interface PhoneNumberReportFields {
  readonly 'phone-country-code': string | null;
  readonly 'phone-is-possible': boolean | null;
  readonly 'phone-is-valid': boolean | null;
  readonly 'phone-type': PhoneLineType | null;
  readonly 'phone-type-numbering-plan': NumberingPlanType | null;
  readonly 'phone-network-line-type': string | null;
  readonly 'phone-carrier': string | null;
  readonly 'phone-risk-level': PhoneRiskLevel | null;
  readonly 'phone-risk-recommendation': PhoneRiskRecommendation | null;
  readonly 'phone-risk-confidence': number | null;
  readonly 'phone-risk-reasons': readonly PhoneLevelReason[];
  readonly 'phone-risk-score': null;
  readonly 'phone-risk-sim-swap': SimSwapLevel | null;
  readonly 'phone-ported-recently': boolean | null;
  readonly 'phone-reachable-at-otp': true | null;
}

/** Non-personal provenance for the sealed result. */
export interface PhoneNumberReportDetails {
  /** Where `phone-type` came from. */
  readonly 'line-type-source': 'numbering_plan' | 'network' | null;
  readonly provider: CheckProvider | null;
  readonly 'reason-confidences': Readonly<Partial<Record<PhoneLevelReason, number>>>;
}

export interface PhoneNumberReportResult {
  readonly fields: PhoneNumberReportFields;
  readonly unavailableFields: readonly UnavailableField[];
  readonly details: PhoneNumberReportDetails;
}

/** The public line type of a numbering-plan type; `null` for `FIXED_LINE_OR_MOBILE`. */
export function phoneTypeOfNumberingPlan(type: NumberingPlanType): PhoneLineType | null {
  return PLAN_TYPES[type];
}

/** The public line type of a network line type; `null` for `unknown`. */
export function phoneTypeOfNetworkLine(type: NetworkLineType): PhoneLineType | null {
  return NETWORK_TYPES[type];
}

/** The recommendation a level carries. */
export function phoneRecommendationOf(level: PhoneRiskLevel): PhoneRiskRecommendation {
  return RECOMMENDATIONS[level];
}

/** Evaluates the `phone-number` report. */
export function evaluatePhoneNumberReport(input: PhoneNumberReportInput): PhoneNumberReportResult {
  const missing = new Map<Field, RiskUnavailableReason>([
    ['phone-risk-score', 'no_documented_method'],
  ]);
  const unknown = (field: Field, reason: RiskUnavailableReason) => missing.set(field, reason);
  const parsed = /^\+\d+$/u.test(input.phoneNumber)
    ? parsePhoneNumberFromString(input.phoneNumber, { extract: false })
    : undefined;
  const valid = parsed?.isValid() ?? false;
  const country = valid ? (parsed?.country ?? null) : null;
  if (country === null) {
    unknown('phone-country-code', 'undetermined');
  }
  const plan = valid ? (parsed?.getType() ?? null) : null;
  if (plan === null) {
    unknown('phone-type-numbering-plan', 'undetermined');
  }
  const provider = readProvider(input.provider, input.now, unknown);
  const network = provider.lineType === null ? null : phoneTypeOfNetworkLine(provider.lineType);
  const planType = valid ? (plan === null ? null : phoneTypeOfNumberingPlan(plan)) : 'INVALID';
  const type = network ?? planType;
  if (type === null) {
    unknown(
      'phone-type',
      plan === 'FIXED_LINE_OR_MOBILE' ? 'line_type_undetermined' : 'undetermined',
    );
  }
  const typeReason =
    type === null
      ? plan === 'FIXED_LINE_OR_MOBILE'
        ? 'line_type_undetermined'
        : null
      : TYPE_REASONS[type];
  const reasons = new Set<PhoneLevelReason>(provider.reasons);
  if (typeReason !== null) {
    reasons.add(typeReason);
  }
  const level = levelOf(
    reasons,
    typeReason === null || REASON_LEVELS[typeReason] === null || provider.blocked,
  );
  if (level === null) {
    const cause = provider.blocked ? 'execution_error' : 'undetermined';
    for (const field of RISK_FIELDS) {
      unknown(field, cause);
    }
  }
  const ordered = PHONE_LEVEL_REASONS.filter((reason) => reasons.has(reason));
  if (input.confirmation !== 'confirmed') {
    unknown('phone-reachable-at-otp', input.confirmation);
  }
  const fields: PhoneNumberReportFields = {
    'phone-country-code': country,
    'phone-is-possible': parsed?.isPossible() ?? false,
    'phone-is-valid': valid,
    'phone-type': type,
    'phone-type-numbering-plan': plan,
    'phone-network-line-type': provider.lineType,
    'phone-carrier': provider.carrier,
    'phone-risk-level': level?.level ?? null,
    'phone-risk-recommendation': level === null ? null : phoneRecommendationOf(level.level),
    'phone-risk-confidence': level?.confidence ?? null,
    'phone-risk-reasons': ordered,
    'phone-risk-score': null,
    'phone-risk-sim-swap': provider.simSwap,
    'phone-ported-recently': provider.ported,
    'phone-reachable-at-otp': input.confirmation === 'confirmed' ? true : null,
  };
  return {
    fields,
    unavailableFields: FIELD_ORDER.flatMap((field) => {
      const reason = missing.get(field);
      return reason === undefined ? [] : [{ field, reason }];
    }),
    details: {
      'line-type-source': type === null ? null : network === null ? 'numbering_plan' : 'network',
      provider: provider.identity,
      'reason-confidences': Object.fromEntries(
        ordered.flatMap((reason) => {
          const scored = REASON_LEVELS[reason];
          return scored === null ? [] : [[reason, riskConstant(scored[1])]];
        }),
      ),
    },
  };
}

type Field = keyof PhoneNumberReportFields;

const FIELD_ORDER: readonly Field[] = [
  'phone-country-code',
  'phone-is-possible',
  'phone-is-valid',
  'phone-type',
  'phone-type-numbering-plan',
  'phone-network-line-type',
  'phone-carrier',
  'phone-risk-level',
  'phone-risk-recommendation',
  'phone-risk-confidence',
  'phone-risk-reasons',
  'phone-risk-score',
  'phone-risk-sim-swap',
  'phone-ported-recently',
  'phone-reachable-at-otp',
];
const RISK_FIELDS: readonly Field[] = [
  'phone-risk-level',
  'phone-risk-recommendation',
  'phone-risk-confidence',
];
const PROVIDER_FIELDS: readonly Field[] = [
  'phone-network-line-type',
  'phone-carrier',
  'phone-risk-sim-swap',
  'phone-ported-recently',
];

const PLAN_TYPES: Readonly<Record<NumberingPlanType, PhoneLineType | null>> = {
  FIXED_LINE: 'FIXED_LINE',
  MOBILE: 'MOBILE',
  FIXED_LINE_OR_MOBILE: null,
  TOLL_FREE: 'TOLL_FREE',
  PREMIUM_RATE: 'RESTRICTED_PREMIUM',
  SHARED_COST: 'RESTRICTED_PREMIUM',
  UAN: 'RESTRICTED_PREMIUM',
  VOIP: 'VOIP',
  PERSONAL_NUMBER: 'PERSONAL',
  PAGER: 'PAGER',
  VOICEMAIL: 'VOICEMAIL',
};

/** C82.2: the network type replaces the plan's (`fixedVoip` is a fixed line, `nonFixedVoip` VoIP). */
const NETWORK_TYPES: Readonly<Record<NetworkLineType, PhoneLineType | null>> = {
  landline: 'FIXED_LINE',
  mobile: 'MOBILE',
  fixedVoip: 'FIXED_LINE',
  nonFixedVoip: 'VOIP',
  personal: 'PERSONAL',
  tollFree: 'TOLL_FREE',
  premium: 'RESTRICTED_PREMIUM',
  sharedCost: 'RESTRICTED_PREMIUM',
  uan: 'RESTRICTED_PREMIUM',
  voicemail: 'VOICEMAIL',
  pager: 'PAGER',
  prepaid: 'PREPAID',
  payphone: 'PAYPHONE',
  other: 'OTHER',
  unknown: null,
};

/** The public band mapping: low and medium-low allow, medium flags, the rest block. */
const RECOMMENDATIONS: Readonly<Record<PhoneRiskLevel, PhoneRiskRecommendation>> = {
  low: 'allow',
  'medium-low': 'allow',
  medium: 'flag',
  'medium-high': 'block',
  high: 'block',
};

/** C82.2's table: each type's reason; `null` where the table has no row. */
const TYPE_REASONS: Readonly<Record<PhoneLineType, PhoneLevelReason | null>> = {
  INVALID: 'invalid_number',
  RESTRICTED_PREMIUM: 'high_risk_type',
  TOLL_FREE: 'high_risk_type',
  PAGER: 'high_risk_type',
  VOICEMAIL: 'high_risk_type',
  VOIP: 'voip',
  PERSONAL: 'personal_number',
  MOBILE: 'low_risk_type',
  FIXED_LINE: 'low_risk_type',
  PREPAID: 'prepaid',
  PAYPHONE: 'payphone',
  OTHER: 'other_line_type',
};

/**
 * Each reason's level and the constant of its confidence (C82.2); `null` for a reason that is
 * stated and adds no level (`other_line_type`, owner decision 14).
 */
const REASON_LEVELS: Readonly<
  Record<PhoneLevelReason, readonly [level: PhoneRiskLevel, confidence: RiskConstantName] | null>
> = {
  invalid_number: ['high', 'phone-confidence-invalid'],
  high_risk_type: ['high', 'phone-confidence-high-risk-type'],
  voip: ['medium-high', 'phone-confidence-voip'],
  prepaid: ['medium', 'phone-confidence-prepaid'],
  payphone: ['medium', 'phone-confidence-payphone'],
  personal_number: ['medium-low', 'phone-confidence-personal'],
  low_risk_type: ['low', 'phone-confidence-low-risk-type'],
  line_type_undetermined: ['low', 'phone-confidence-undetermined'],
  other_line_type: null,
  sim_swap_24h: ['high', 'phone-confidence-sim-swap-24h'],
  sim_swap_7d: ['medium-high', 'phone-confidence-sim-swap-7d'],
  ported_30d: ['medium', 'phone-confidence-ported'],
};

/**
 * The worst level the reasons reach, with the highest confidence among its reasons; `null` when
 * a part that could not be read (the type, or a failed provider) could reach a worse one.
 */
function levelOf(
  reasons: ReadonlySet<PhoneLevelReason>,
  incomplete: boolean,
): { level: PhoneRiskLevel; confidence: number } | null {
  const rank = (level: PhoneRiskLevel) => PHONE_RISK_LEVELS.indexOf(level);
  const scored = [...reasons].flatMap((reason) => {
    const entry = REASON_LEVELS[reason];
    return entry === null ? [] : [entry];
  });
  let worst: PhoneRiskLevel | null = null;
  for (const [level] of scored) {
    if (worst === null || rank(level) > rank(worst)) {
      worst = level;
    }
  }
  if (worst === null || (incomplete && worst !== 'high')) {
    return null;
  }
  const confidence = Math.max(
    ...scored.filter(([level]) => level === worst).map(([, name]) => riskConstant(name)),
  );
  return { level: worst, confidence };
}

interface ProviderReading {
  readonly identity: CheckProvider | null;
  readonly lineType: NetworkLineType | null;
  readonly carrier: string | null;
  readonly simSwap: SimSwapLevel | null;
  readonly ported: boolean | null;
  readonly reasons: readonly PhoneLevelReason[];
  /** The provider failed: what it would have said is unknown. */
  readonly blocked: boolean;
}

const HOUR_MS = 3_600_000;

function readProvider(
  outcome: ProviderOutcome<PhoneIntelligenceLookup> | undefined,
  now: Date,
  unknown: (field: Field, reason: RiskUnavailableReason) => void,
): ProviderReading {
  if (outcome?.kind !== 'result') {
    const failed = outcome?.kind === 'error';
    for (const field of PROVIDER_FIELDS) {
      unknown(field, failed ? 'execution_error' : 'provider_not_configured');
    }
    return {
      identity: null,
      lineType: null,
      carrier: null,
      simSwap: null,
      ported: null,
      reasons: [],
      blocked: failed,
    };
  }
  const { lineType, carrier, simSwap, porting } = outcome.result;
  const known = lineType === 'unknown' ? null : lineType;
  if (known === null) {
    unknown('phone-network-line-type', 'undetermined');
  }
  if (carrier === null) {
    unknown('phone-carrier', 'undetermined');
  }
  const reasons: PhoneLevelReason[] = [];
  const hoursSince = (at: Date) => (now.getTime() - at.getTime()) / HOUR_MS;
  let simSwapLevel: SimSwapLevel = 'N/A';
  if (simSwap.checked) {
    const hours = simSwap.lastSwapAt === null ? Infinity : hoursSince(simSwap.lastSwapAt);
    simSwapLevel = simSwapLevelOf(hours);
    if (hours <= riskConstant('phone-sim-swap-high-hours')) {
      reasons.push('sim_swap_24h');
    } else if (hours <= riskConstant('phone-sim-swap-medium-hours')) {
      reasons.push('sim_swap_7d');
    }
  }
  let ported: boolean | null = null;
  if (porting.checked) {
    ported =
      porting.lastPortedAt !== null &&
      hoursSince(porting.lastPortedAt) <= riskConstant('phone-ported-recent-days') * 24;
    if (ported) {
      reasons.push('ported_30d');
    }
  } else {
    unknown('phone-ported-recently', 'undetermined');
  }
  return {
    identity: outcome.provider,
    lineType: known,
    carrier,
    simSwap: simSwapLevel,
    ported,
    reasons,
    blocked: false,
  };
}

/** `phone-risk-sim-swap` from the hours since the last swap (ours, C82.2's windows). */
function simSwapLevelOf(hours: number): SimSwapLevel {
  if (hours <= riskConstant('phone-sim-swap-high-hours')) {
    return 'high';
  }
  if (hours <= riskConstant('phone-sim-swap-medium-hours')) {
    return 'medium';
  }
  return hours <= riskConstant('phone-sim-swap-low-hours') ? 'low' : 'very-low';
}
