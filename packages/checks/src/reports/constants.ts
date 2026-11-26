/**
 * The provisional constants of the report risk logic (plan C81.3, C82; ADR 0002 §3c, §3f): every
 * confidence, window and weight the email, phone and media rules use, each with its basis and the
 * source of its value. None is tuned on an evaluation set; a change needs a calibration report.
 * The template keys (`min-domain-age-days`, `young-domain-days`, `max-article-age-days`, ...) are
 * not here: they are `REPORT_CONFIG_DEFAULTS` in `@openverify/core`.
 */
import type { ThresholdBasis } from '@openverify/core';

/** A constant with its basis and the source of its value (as core's `ConfigDefault`). */
export interface RiskConstant {
  readonly value: number;
  readonly basis: ThresholdBasis;
  readonly source: string;
}

/** The name of every constant, in the order the rules read them. */
export const REPORT_RISK_CONSTANT_NAMES = [
  'email-confidence-list-fact',
  'email-confidence-domain-age',
  'email-confidence-mx-heuristic',
  'email-confidence-role-account',
  'email-confidence-young-domain',
  'email-confidence-breach',
  'email-confidence-typo',
  'email-confidence-accepts-mail',
  'email-breach-window-days',
  'email-typo-max-edits',
  'email-typo-reference-min-label',
  'email-dmarc-max-queries',
  'email-txt-max-length',
  'phone-confidence-invalid',
  'phone-confidence-high-risk-type',
  'phone-confidence-voip',
  'phone-confidence-prepaid',
  'phone-confidence-payphone',
  'phone-confidence-personal',
  'phone-confidence-low-risk-type',
  'phone-confidence-undetermined',
  'phone-confidence-sim-swap-24h',
  'phone-confidence-sim-swap-7d',
  'phone-confidence-ported',
  'phone-sim-swap-high-hours',
  'phone-sim-swap-medium-hours',
  'phone-sim-swap-low-hours',
  'phone-ported-recent-days',
  'address-cmra-hint-confidence',
  'media-confidence-cap',
  'media-weight-name',
  'media-weight-category',
  'media-weight-recency',
  'media-name-full',
  'media-name-all-tokens',
  'media-recency-floor',
  'media-title-max-length',
  'media-title-read-length',
] as const;
export type RiskConstantName = (typeof REPORT_RISK_CONSTANT_NAMES)[number];

const provisional = (value: number, source: string): RiskConstant =>
  Object.freeze({ value, basis: 'provisional', source });

const EMAIL_BAND = 'C82.1 band table (H07; research phase6-risk-reports.md §1.9)';
const PHONE_TABLE = 'C82.2 risk table (H08; research phase6-risk-reports.md §2.3)';
const PHONE_PROVIDER_TYPES =
  'ours, owner decision 14 (plan, owner decisions after Workflows 6A and 6B): a provider-reported line type';
const PHONE_WINDOWS =
  'ours, C82.2: the research leaves the SIM swap and port windows to us (§2.3, Needs the owner C7)';
const MEDIA_SCORE =
  'ours, C81.3: the media score reads the title match, category weight and recency';

/** Every constant, by name. */
export const REPORT_RISK_CONSTANTS: Readonly<Record<RiskConstantName, RiskConstant>> =
  Object.freeze({
    'email-confidence-list-fact': provisional(
      0.95,
      `${EMAIL_BAND}: low, for the DNS and list facts (syntax, NXDOMAIN, null MX, no mail server, disposable)`,
    ),
    'email-confidence-domain-age': provisional(
      0.7,
      `${EMAIL_BAND}: low, for a custom domain younger than min-domain-age-days (RDAP)`,
    ),
    'email-confidence-mx-heuristic': provisional(
      0.5,
      `${EMAIL_BAND}: low, for the MX heuristic (a custom domain served by a disposable service)`,
    ),
    'email-confidence-role-account': provisional(
      0.6,
      `${EMAIL_BAND}: medium 0.4-0.6; a role mailbox is a fact, and a shared mailbox names no one person`,
    ),
    'email-confidence-young-domain': provisional(
      0.5,
      `${EMAIL_BAND}: medium 0.4-0.6; a young custom domain is weaker evidence than a new one`,
    ),
    'email-confidence-breach': provisional(
      0.5,
      `${EMAIL_BAND}: medium 0.4-0.6; a breach shows the address was exposed, not that it is risky`,
    ),
    'email-confidence-typo': provisional(
      0.4,
      `${EMAIL_BAND}: medium 0.4-0.6; a near miss of a major domain can be a real company (§1.7)`,
    ),
    'email-confidence-accepts-mail': provisional(
      0.5,
      `${EMAIL_BAND}: high, an absence of bad signals is weak evidence`,
    ),
    'email-breach-window-days': provisional(
      365,
      'C82.1: a breach in the last 12 months from a bound emailIntelligence provider is medium',
    ),
    'email-typo-max-edits': provisional(
      1,
      'C82.1, research §1.7: a Damerau-Levenshtein distance of 1 from a major free-mail domain',
    ),
    'email-typo-reference-min-label': provisional(
      5,
      'ours: shorter names (aol, gmx, qq) sit one edit from many real domains, so they are no typo reference',
    ),
    'email-dmarc-max-queries': provisional(
      8,
      'C82.1, RFC 9989 §4.10: the DNS tree walk makes at most eight queries',
    ),
    'email-txt-max-length': provisional(
      4096,
      'C85.2: the TXT answer cap of 4 KiB; a longer record is not read',
    ),
    'phone-confidence-invalid': provisional(0.95, `${PHONE_TABLE}: INVALID is high / block`),
    'phone-confidence-high-risk-type': provisional(
      0.9,
      `${PHONE_TABLE}: RESTRICTED_PREMIUM, TOLL_FREE, PAGER and VOICEMAIL are high / block (the set C55.8 refuses for OTP)`,
    ),
    'phone-confidence-voip': provisional(0.7, `${PHONE_TABLE}: VOIP is medium-high / block`),
    'phone-confidence-prepaid': provisional(
      0.4,
      `${PHONE_PROVIDER_TYPES}: PREPAID is medium / flag, as the public mapping flags it; many people use prepaid lines, so it is weak evidence, weighed as a recent port`,
    ),
    'phone-confidence-payphone': provisional(
      0.4,
      `${PHONE_PROVIDER_TYPES}: PAYPHONE is medium / flag; rare for a person verifying, but not fraud evidence by itself, so weighed as a recent port`,
    ),
    'phone-confidence-personal': provisional(0.5, `${PHONE_TABLE}: PERSONAL is medium-low / allow`),
    'phone-confidence-low-risk-type': provisional(
      0.5,
      `${PHONE_TABLE}: MOBILE and FIXED_LINE are low / allow`,
    ),
    'phone-confidence-undetermined': provisional(
      0.3,
      `${PHONE_TABLE}, decision 51: an undetermined plan type (FIXED_LINE_OR_MOBILE) is low / allow`,
    ),
    'phone-confidence-sim-swap-24h': provisional(
      0.8,
      `${PHONE_WINDOWS}; a provider-reported SIM swap within a day is strong takeover evidence`,
    ),
    'phone-confidence-sim-swap-7d': provisional(
      0.6,
      `${PHONE_WINDOWS}; a SIM swap within a week is weaker`,
    ),
    'phone-confidence-ported': provisional(
      0.4,
      `${PHONE_WINDOWS}; people port numbers when they change carrier, so a recent port is weak evidence`,
    ),
    'phone-sim-swap-high-hours': provisional(
      24,
      'C82.2: a SIM swap within 24 h gives high (ours; research §2.3)',
    ),
    'phone-sim-swap-medium-hours': provisional(
      168,
      'C82.2: a SIM swap within 7 days gives medium-high (ours; research §2.3)',
    ),
    'phone-sim-swap-low-hours': provisional(
      720,
      'ours: phone-risk-sim-swap reads low for a swap within 30 days, very-low beyond',
    ),
    'phone-ported-recent-days': provisional(
      30,
      'C82.2: a port within 30 days gives medium (ours; research §2.3)',
    ),
    'address-cmra-hint-confidence': provisional(
      0.6,
      'ours, C82.3 (H08): a private mailbox (PMB) designator is how a CMRA customer writes the box, though PMB is not proof',
    ),
    'media-confidence-cap': provisional(
      0.6,
      'C81.3: name co-occurrence in a title is not identity, so an article confidence is at most 0.6',
    ),
    'media-weight-name': provisional(0.5, `${MEDIA_SCORE}: the share of the name match`),
    'media-weight-category': provisional(0.3, `${MEDIA_SCORE}: the share of the category weight`),
    'media-weight-recency': provisional(0.2, `${MEDIA_SCORE}: the share of recency`),
    'media-name-full': provisional(1, `${MEDIA_SCORE}: the whole name, in order, in the title`),
    'media-name-all-tokens': provisional(
      0.8,
      `${MEDIA_SCORE}: every token of the name in the title, in any order`,
    ),
    'media-recency-floor': provisional(
      0.5,
      `${MEDIA_SCORE}: recency falls linearly to this at max-article-age-days`,
    ),
    'media-title-max-length': provisional(
      200,
      'C81.4, decision 8: a stored title is at most 200 characters, shown only as link text',
    ),
    'media-title-read-length': provisional(
      1000,
      'ours (C58.7): the relevance reads at most this many code points of a title',
    ),
  });

/** A constant's value. */
export function riskConstant(name: RiskConstantName): number {
  return REPORT_RISK_CONSTANTS[name].value;
}

/**
 * Why a report field is `null` (C69.4), as the contracts' `REPORT_UNAVAILABLE_REASONS` name them;
 * the risk logic uses these, and the API's contract test ties the two lists together.
 */
export const RISK_UNAVAILABLE_REASONS = [
  'provider_not_configured',
  'not_confirmed',
  'not_linked',
  'line_type_undetermined',
  'unsupported_country',
  'undetermined',
  'execution_error',
  'no_adapter',
  'no_documented_method',
] as const;
export type RiskUnavailableReason = (typeof RISK_UNAVAILABLE_REASONS)[number];

/** A field left `null`, and why (the contracts' `unavailable-fields` entry). */
export interface UnavailableField {
  readonly field: string;
  readonly reason: RiskUnavailableReason;
}

/**
 * Whether the report's inquiry confirmed this exact destination by OTP (C55, C84.2; P05):
 * `not_linked` for every report not created by an inquiry's completion, so no API caller can test
 * guessed values against an inquiry's confirmed one.
 */
export type ContactConfirmation = 'confirmed' | 'not_confirmed' | 'not_linked';
