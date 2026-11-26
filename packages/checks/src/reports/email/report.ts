/**
 * C82.1: the `email-address` report's R and H fields from what the job looked up, as a pure
 * function. The job (`api-providers`) parses nothing itself: it passes the address, the answers of
 * its lookups (MX with real exchange host names, the domain's TXT records, the DMARC walk, RDAP
 * when {@link shouldQueryEmailDomainAge} says so, the `emailIntelligence` provider when bound) and
 * whether the inquiry confirmed this address by OTP, and serves what comes back.
 *
 * `email-reputation` (H, `beta`) is the worst band any reason reaches (C82.1's table):
 *
 * | Band | Reasons | Confidence |
 * |---|---|---|
 * | `low` | `syntax_invalid`, `domain_not_found`, `domain_rejects_mail`, `no_mail_server`, `disposable_domain` | 0.95 |
 * | `low` | `domain_recently_registered` (custom domain, age < `min-domain-age-days`) | 0.7 |
 * | `low` | `mx_of_disposable_service` | 0.5 |
 * | `medium` | `role_account` 0.6, `young_domain` 0.5, `recent_breach` 0.5, `domain_typo_of_major_provider` 0.4 | the highest |
 * | `high` | `accepts_mail`, and nothing above | 0.5 |
 * | `null` | `privacy_relay`; or a check that could reach a worse band than the one reached could not run | — |
 *
 * A worse band that a failed lookup could have reached is never hidden: a DNS timeout never gives
 * `high`, and a breach provider error never gives `high` either. Free provider, MX provider, SPF
 * and DMARC never change the band. Deliverability is `true` only for an OTP-confirmed address,
 * never `false`. The fields no adapter or documented method fills are always `null`.
 */
import { REPORT_CONFIG_DEFAULTS, type CheckModel, type CheckProvider } from '@openverify/core';
import type { DomainAgeLookup } from '../../business/inputs.js';
import { validateEmailDestination } from '../../contact/email-destination.js';
import type { DisposableDomainList, MxLookupResult } from '../../contact/inputs.js';
import { sandboxMailDomainRule } from '../../contact/mail-domain.js';
import type { EnvironmentKind } from '../../data/feature-table.js';
import type { ProviderOutcome } from '../../government-id/inputs.js';
import {
  riskConstant,
  type ContactConfirmation,
  type RiskConstantName,
  type RiskUnavailableReason,
  type UnavailableField,
} from '../constants.js';
import type { DmarcFoundAt, DmarcOutcome, DmarcPolicy } from './dmarc.js';
import {
  classifyEmailDomain,
  emailTypoSuggestionOf,
  mxOfDisposableService,
  shouldQueryEmailDomainAge,
  type EmailDomainKind,
} from './domain.js';
import { readSpfPolicy, type SpfPolicy, type TxtRecords } from './spf.js';
import { emailTablesDigest, isRoleLocalPart, mxProviderOf } from './tables.js';

/** Why the email band is what it is (the contracts' `EMAIL_REPUTATION_REASONS`, in order). */
export const EMAIL_BAND_REASONS = [
  'syntax_invalid',
  'domain_not_found',
  'domain_rejects_mail',
  'no_mail_server',
  'disposable_domain',
  'domain_recently_registered',
  'mx_of_disposable_service',
  'domain_typo_of_major_provider',
  'role_account',
  'young_domain',
  'recent_breach',
  'accepts_mail',
  'privacy_relay',
  'execution_error',
] as const;
export type EmailBandReason = (typeof EMAIL_BAND_REASONS)[number];

/** `email-reputation`: `high` is trustworthy, `low` risky (the public direction). */
export const EMAIL_BANDS = ['high', 'medium', 'low'] as const;
export type EmailBand = (typeof EMAIL_BANDS)[number];

/** A TXT lookup's answer: records, or none (NXDOMAIN or NODATA). */
export type TxtAnswer =
  { readonly kind: 'records'; readonly records: TxtRecords } | { readonly kind: 'none' };

/** What a bound `emailIntelligence` provider said about the address. */
export interface EmailBreachLookup {
  /** Breaches the address appears in. */
  readonly breachCount: number;
  /** The newest breach's date, or `null` when the provider gives none. */
  readonly latestBreachAt: Date | null;
}

/** What the job passes. */
export interface EmailAddressReportInput {
  /** The query's `email-address`. */
  readonly emailAddress: string;
  /** `production` when absent; a sandbox reads C82.4's reserved names without DNS. */
  readonly environment?: EnvironmentKind | undefined;
  /** The evaluation instant (domain age, breach recency). */
  readonly now: Date;
  /** The template's thresholds; `REPORT_CONFIG_DEFAULTS['email-address']` when absent. */
  readonly config?:
    | {
        readonly 'min-domain-age-days'?: number | undefined;
        readonly 'young-domain-days'?: number | undefined;
      }
    | undefined;
  /** C56's list as the API loaded it; `null` without the file. */
  readonly disposableList: DisposableDomainList | null;
  /**
   * The MX lookup, with the exchanges' real host names, most preferred first; absent when none was
   * made (a sandbox reserved name needs none).
   */
  readonly mx?: ProviderOutcome<MxLookupResult> | undefined;
  /** The domain's own TXT records (SPF). */
  readonly txt?: ProviderOutcome<TxtAnswer> | undefined;
  /** The DMARC walk (`walkDmarc`); `not_configured` without a resolver. */
  readonly dmarc?: DmarcOutcome | { readonly kind: 'not_configured' } | undefined;
  /** RDAP's answer when asked; absent when the report did not ask. */
  readonly domainAge?: ProviderOutcome<DomainAgeLookup> | undefined;
  /** The `emailIntelligence` provider's answer; absent or `not_configured` when unbound. */
  readonly breach?: ProviderOutcome<EmailBreachLookup> | undefined;
  readonly confirmation: ContactConfirmation;
}

/** The type's fields, as `emailAddressReportResourceSchema` names them. */
export interface EmailAddressReportFields {
  readonly 'email-domain': string | null;
  readonly 'email-domain-kind': EmailDomainKind | null;
  readonly 'email-domain-exists': boolean | null;
  readonly 'email-is-valid-mx': boolean | null;
  readonly 'email-is-disposable': boolean | null;
  readonly 'email-domain-age-days': number | null;
  readonly 'email-is-free-provider': boolean | null;
  readonly 'email-is-relay': boolean | null;
  readonly 'email-is-role-account': boolean | null;
  readonly 'email-mx-provider': string | null;
  readonly 'email-spf-policy': SpfPolicy | null;
  readonly 'email-dmarc-policy': DmarcPolicy | null;
  readonly 'email-is-deliverable': true | null;
  readonly 'email-domain-typo-suggestion': string | null;
  readonly 'email-reputation': EmailBand | null;
  readonly 'email-is-suspicious': boolean | null;
  readonly 'email-reputation-confidence': number | null;
  readonly 'email-reputation-reasons': readonly EmailBandReason[];
  readonly 'email-credentials-leaked-recent': boolean | null;
  readonly 'email-breach-count': number | null;
  readonly 'email-is-spam': null;
  readonly 'email-malicious-activity-detected-recent': null;
  readonly 'email-estimated-age-days': null;
  readonly 'age-estimated-13-plus': null;
  readonly 'age-estimated-16-plus': null;
  readonly 'age-estimated-18-plus': null;
}

/** Non-personal provenance for the sealed result (ADR 0002 §3f). */
export interface EmailAddressReportDetails {
  readonly 'disposable-list': CheckModel | null;
  /** `emailTablesDigest()`: which authored tables answered. */
  readonly 'email-tables-sha256': string;
  /** The local part is internationalised (SMTPUTF8): its syntax is read, its role is not. */
  readonly 'internationalised-local-part': boolean;
  /** The SPF record defers to another domain's (`redirect=`), which was not followed. */
  readonly 'spf-redirect': boolean;
  readonly 'dmarc-found-at': DmarcFoundAt | null;
  readonly 'dmarc-testing': boolean;
  readonly 'dmarc-queries': number;
  /** RDAP was asked (custom domains only). */
  readonly 'domain-age-requested': boolean;
  /** The provider that answered the breach lookup. */
  readonly 'breach-provider': CheckProvider | null;
  /** Each reason that applied, with the confidence it carries. */
  readonly 'reason-confidences': Readonly<Partial<Record<EmailBandReason, number>>>;
}

/** The report's fields, the ones left `null` and why, the thresholds served and the provenance. */
export interface EmailAddressReportResult {
  readonly fields: EmailAddressReportFields;
  readonly unavailableFields: readonly UnavailableField[];
  readonly thresholds: {
    readonly 'min-domain-age-days': number;
    readonly 'young-domain-days': number;
  };
  readonly details: EmailAddressReportDetails;
}

/** The domain an address names (lower-case ASCII), or `null` when its syntax is invalid. */
export function emailReportDomainOf(emailAddress: string): string | null {
  return parseAddress(emailAddress)?.domain ?? null;
}

/** Evaluates the `email-address` report. */
export function evaluateEmailAddressReport(
  input: EmailAddressReportInput,
): EmailAddressReportResult {
  const thresholds = {
    'min-domain-age-days':
      input.config?.['min-domain-age-days'] ?? defaultThreshold('min-domain-age-days'),
    'young-domain-days':
      input.config?.['young-domain-days'] ?? defaultThreshold('young-domain-days'),
  };
  const report = new EmailReport();
  report.readConfirmation(input.confirmation);
  report.readBreach(input.breach, input.now);
  const parsed = parseAddress(input.emailAddress);
  if (parsed === null) {
    report.apply('syntax_invalid');
    for (const field of DOMAIN_FIELDS) {
      report.unknown(field, 'undetermined');
    }
  } else {
    report.readDomain(input, parsed, thresholds);
  }
  return {
    fields: report.finish(),
    unavailableFields: report.unavailableFields(),
    thresholds,
    details: {
      'disposable-list': input.disposableList?.source ?? null,
      'email-tables-sha256': emailTablesDigest(),
      'internationalised-local-part': parsed?.internationalised ?? false,
      ...report.details,
      'reason-confidences': report.confidences(),
    },
  };
}

type Fields = { -readonly [Key in keyof EmailAddressReportFields]: EmailAddressReportFields[Key] };
type Field = keyof Fields;

/** Every field at `null` (no reason yet), in the contracts' order. */
const EMPTY_FIELDS: Readonly<Fields> = Object.freeze({
  'email-domain': null,
  'email-domain-kind': null,
  'email-domain-exists': null,
  'email-is-valid-mx': null,
  'email-is-disposable': null,
  'email-domain-age-days': null,
  'email-is-free-provider': null,
  'email-is-relay': null,
  'email-is-role-account': null,
  'email-mx-provider': null,
  'email-spf-policy': null,
  'email-dmarc-policy': null,
  'email-is-deliverable': null,
  'email-domain-typo-suggestion': null,
  'email-reputation': null,
  'email-is-suspicious': null,
  'email-reputation-confidence': null,
  'email-reputation-reasons': [],
  'email-credentials-leaked-recent': null,
  'email-breach-count': null,
  'email-is-spam': null,
  'email-malicious-activity-detected-recent': null,
  'email-estimated-age-days': null,
  'age-estimated-13-plus': null,
  'age-estimated-16-plus': null,
  'age-estimated-18-plus': null,
});
const FIELD_ORDER = Object.keys(EMPTY_FIELDS) as Field[];

/** The fields a domain gives; all unknown for an address that is none. */
const DOMAIN_FIELDS: readonly Field[] = [
  'email-domain',
  'email-domain-kind',
  'email-domain-exists',
  'email-is-valid-mx',
  'email-is-disposable',
  'email-domain-age-days',
  'email-is-free-provider',
  'email-is-relay',
  'email-is-role-account',
  'email-mx-provider',
  'email-spf-policy',
  'email-dmarc-policy',
  'email-domain-typo-suggestion',
];
/** C82.1: no adapter fills these in Phase 6; the age estimates have no documented method. */
const NO_ADAPTER: readonly Field[] = [
  'email-is-spam',
  'email-malicious-activity-detected-recent',
  'email-estimated-age-days',
];
const NO_METHOD: readonly Field[] = [
  'age-estimated-13-plus',
  'age-estimated-16-plus',
  'age-estimated-18-plus',
];
const BAND_FIELDS: readonly Field[] = [
  'email-reputation',
  'email-is-suspicious',
  'email-reputation-confidence',
];

/** Each reason's band and the constant of its confidence (C82.1). */
const REASON_BANDS: Readonly<
  Partial<Record<EmailBandReason, readonly [band: EmailBand, confidence: RiskConstantName]>>
> = {
  syntax_invalid: ['low', 'email-confidence-list-fact'],
  domain_not_found: ['low', 'email-confidence-list-fact'],
  domain_rejects_mail: ['low', 'email-confidence-list-fact'],
  no_mail_server: ['low', 'email-confidence-list-fact'],
  disposable_domain: ['low', 'email-confidence-list-fact'],
  domain_recently_registered: ['low', 'email-confidence-domain-age'],
  mx_of_disposable_service: ['low', 'email-confidence-mx-heuristic'],
  domain_typo_of_major_provider: ['medium', 'email-confidence-typo'],
  role_account: ['medium', 'email-confidence-role-account'],
  young_domain: ['medium', 'email-confidence-young-domain'],
  recent_breach: ['medium', 'email-confidence-breach'],
  accepts_mail: ['high', 'email-confidence-accepts-mail'],
};

/** Which missing answer wins when several blocked the band: the most specific. */
const CAUSE_ORDER: readonly RiskUnavailableReason[] = [
  'execution_error',
  'provider_not_configured',
  'undetermined',
];

const DAY_MS = 86_400_000;

function defaultThreshold(key: 'min-domain-age-days' | 'young-domain-days'): number {
  const value = REPORT_CONFIG_DEFAULTS['email-address'][key]?.value;
  return typeof value === 'number' ? value : 0;
}

interface ParsedAddress {
  readonly localPart: string;
  readonly domain: string;
  readonly internationalised: boolean;
}

/**
 * C55.8's syntax, with one difference: an internationalised (SMTPUTF8, RFC 6531) local part is a
 * valid address here. The OTP sender refuses it, but a report only reads its domain and role.
 */
function parseAddress(value: string): ParsedAddress | null {
  const checked = validateEmailDestination(value);
  if (checked.ok) {
    const at = checked.address.lastIndexOf('@');
    return {
      localPart: checked.address.slice(0, at),
      domain: checked.domain,
      internationalised: false,
    };
  }
  if (checked.refusal !== 'local_part_not_ascii') {
    return null;
  }
  const text = value.trim();
  const at = text.lastIndexOf('@');
  const localPart = text.slice(0, at);
  const domain = validateEmailDestination(`x@${text.slice(at + 1)}`);
  return domain.ok &&
    Buffer.byteLength(localPart, 'utf8') <= 64 &&
    INTERNATIONAL_DOT_STRING.test(localPart)
    ? { localPart, domain: domain.domain, internationalised: true }
    : null;
}

/** RFC 6531 §3.3: a dot-string over the WHATWG atext set and any non-ASCII character. */
const INTERNATIONAL_DOT_STRING =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /^(?:[\w!#$%&'*+/=?^`{|}~-]|[^\0-\x7f])+(?:\.(?:[\w!#$%&'*+/=?^`{|}~-]|[^\0-\x7f])+)*$/u;

const isNullMx = (exchange: string) => exchange === '' || exchange === '.';
/** A host name has a dot; C56's cache keeps an exchange as the bare word `exchange`. */
const isHostName = (exchange: string) => exchange.includes('.');

/** The fields as they are worked out, with the reasons, the blocked checks and the details. */
class EmailReport {
  readonly fields: Fields = { ...EMPTY_FIELDS, 'email-reputation-reasons': [] };
  readonly #missing = new Map<Field, RiskUnavailableReason>();
  readonly #applied = new Set<EmailBandReason>();
  readonly #blocked: { band: 'low' | 'medium'; cause: RiskUnavailableReason }[] = [];
  #accepts: boolean | null = null;
  #relay = false;
  details: Omit<
    EmailAddressReportDetails,
    | 'disposable-list'
    | 'email-tables-sha256'
    | 'internationalised-local-part'
    | 'reason-confidences'
  > = {
    'spf-redirect': false,
    'dmarc-found-at': null,
    'dmarc-testing': false,
    'dmarc-queries': 0,
    'domain-age-requested': false,
    'breach-provider': null,
  };

  constructor() {
    for (const field of NO_ADAPTER) {
      this.unknown(field, 'no_adapter');
    }
    for (const field of NO_METHOD) {
      this.unknown(field, 'no_documented_method');
    }
  }

  set<Key extends Field>(field: Key, value: Fields[Key]): void {
    this.fields[field] = value;
  }

  unknown(field: Field, reason: RiskUnavailableReason): void {
    this.#missing.set(field, reason);
  }

  apply(reason: EmailBandReason): void {
    this.#applied.add(reason);
  }

  block(band: 'low' | 'medium', cause: RiskUnavailableReason): void {
    this.#blocked.push({ band, cause });
  }

  readConfirmation(confirmation: ContactConfirmation): void {
    if (confirmation === 'confirmed') {
      this.set('email-is-deliverable', true);
    } else {
      this.unknown('email-is-deliverable', confirmation);
    }
  }

  readBreach(outcome: ProviderOutcome<EmailBreachLookup> | undefined, now: Date): void {
    const fields: Field[] = ['email-credentials-leaked-recent', 'email-breach-count'];
    if (outcome?.kind !== 'result') {
      const cause = outcome?.kind === 'error' ? 'execution_error' : 'provider_not_configured';
      for (const field of fields) {
        this.unknown(field, cause);
      }
      if (cause === 'execution_error') {
        this.block('medium', cause);
      }
      return;
    }
    this.details = { ...this.details, 'breach-provider': outcome.provider };
    const { breachCount, latestBreachAt } = outcome.result;
    this.set('email-breach-count', breachCount);
    if (latestBreachAt === null) {
      if (breachCount === 0) {
        this.set('email-credentials-leaked-recent', false);
      } else {
        this.unknown('email-credentials-leaked-recent', 'undetermined');
        this.block('medium', 'undetermined');
      }
      return;
    }
    const recent =
      now.getTime() - latestBreachAt.getTime() <= riskConstant('email-breach-window-days') * DAY_MS;
    this.set('email-credentials-leaked-recent', recent);
    if (recent) {
      this.apply('recent_breach');
    }
  }

  readDomain(
    input: EmailAddressReportInput,
    { localPart, domain, internationalised }: ParsedAddress,
    thresholds: { 'min-domain-age-days': number; 'young-domain-days': number },
  ): void {
    const environment = input.environment ?? 'production';
    const disposable = input.disposableList?.domains ?? null;
    const { kind } = classifyEmailDomain(domain, { disposable, environment });
    this.#relay = kind === 'relay';
    this.set('email-domain', domain);
    this.set('email-domain-kind', kind);
    this.set('email-is-free-provider', kind === 'free_mail');
    this.set('email-is-relay', kind === 'relay');
    this.set('email-is-role-account', !internationalised && isRoleLocalPart(localPart));
    if (this.fields['email-is-role-account'] === true) {
      this.apply('role_account');
    }
    if (kind === null) {
      this.unknown('email-domain-kind', 'undetermined');
      this.unknown('email-is-disposable', 'undetermined');
      this.block('low', 'undetermined');
    } else {
      this.set('email-is-disposable', kind === 'disposable');
      if (kind === 'disposable') {
        this.apply('disposable_domain');
      }
    }
    const reserved = sandboxMailDomainRule(domain, environment);
    const exchanges = this.readMx(reserved, input.mx);
    const custom = shouldQueryEmailDomainAge(kind);
    if (custom && disposable !== null) {
      if (!exchanges.every(isHostName)) {
        // The exchanges' names were not kept (C56's cache masks them): the heuristic cannot run.
        this.block('low', 'undetermined');
      } else if (mxOfDisposableService(exchanges, disposable)) {
        this.apply('mx_of_disposable_service');
      }
    }
    this.readDomainAge(custom ? input.domainAge : null, input.now, thresholds);
    const typo = custom ? emailTypoSuggestionOf(domain) : null;
    this.set('email-domain-typo-suggestion', typo);
    if (typo !== null) {
      this.apply('domain_typo_of_major_provider');
    }
    if (reserved === null) {
      this.readSpf(input.txt);
      this.readDmarc(input.dmarc);
    } else {
      this.unknown('email-spf-policy', 'undetermined');
      this.unknown('email-dmarc-policy', 'undetermined');
    }
  }

  /** The DNS answer for mail; the usable exchanges it named. */
  readMx(
    reserved: 'accepts_mail' | 'not_found' | null,
    outcome: ProviderOutcome<MxLookupResult> | undefined,
  ): string[] {
    if (reserved !== null) {
      this.readMail(reserved === 'accepts_mail', reserved === 'accepts_mail', true);
      if (reserved === 'not_found') {
        this.apply('domain_not_found');
      }
      this.unknown('email-mx-provider', 'undetermined');
      return [];
    }
    if (outcome?.kind !== 'result' || isEmptyMx(outcome.result)) {
      const cause =
        outcome?.kind === 'error' || outcome?.kind === 'result'
          ? 'execution_error'
          : 'provider_not_configured';
      for (const field of [
        'email-domain-exists',
        'email-is-valid-mx',
        'email-mx-provider',
      ] as const) {
        this.unknown(field, cause);
      }
      this.block('low', cause);
      return [];
    }
    const { result } = outcome;
    if (result.kind === 'not_found') {
      this.readMail(false, false, false);
      this.apply('domain_not_found');
      this.unknown('email-mx-provider', 'undetermined');
      return [];
    }
    if (result.kind === 'no_mx') {
      const accepts = result.addressRecords > 0;
      this.readMail(true, false, accepts);
      if (!accepts) {
        this.apply('no_mail_server');
      }
      this.unknown('email-mx-provider', 'undetermined');
      return [];
    }
    const exchanges = result.exchanges.filter((exchange) => !isNullMx(exchange));
    this.readMail(true, exchanges.length > 0, exchanges.length > 0);
    if (exchanges.length === 0) {
      this.apply('domain_rejects_mail');
    }
    const provider = mxProviderOf(exchanges);
    this.set('email-mx-provider', provider?.id ?? null);
    if (provider === null) {
      this.unknown('email-mx-provider', 'undetermined');
    }
    return exchanges;
  }

  readMail(exists: boolean, validMx: boolean, accepts: boolean): void {
    this.set('email-domain-exists', exists);
    this.set('email-is-valid-mx', validMx);
    this.#accepts = accepts;
  }

  readDomainAge(
    outcome: ProviderOutcome<DomainAgeLookup> | null | undefined,
    now: Date,
    thresholds: { 'min-domain-age-days': number; 'young-domain-days': number },
  ): void {
    this.details = { ...this.details, 'domain-age-requested': outcome !== null };
    if (outcome === null) {
      this.unknown('email-domain-age-days', 'undetermined');
      return;
    }
    if (outcome?.kind !== 'result') {
      const cause = outcome?.kind === 'error' ? 'execution_error' : 'provider_not_configured';
      this.unknown('email-domain-age-days', cause);
      if (cause === 'execution_error') {
        this.block('low', cause);
      }
      return;
    }
    const { result } = outcome;
    if (result.outcome === 'unavailable') {
      this.unknown('email-domain-age-days', 'undetermined');
      return;
    }
    const days = Math.max(0, Math.floor((now.getTime() - result.registeredAt.getTime()) / DAY_MS));
    this.set('email-domain-age-days', days);
    if (days < thresholds['min-domain-age-days']) {
      this.apply('domain_recently_registered');
    } else if (days < thresholds['young-domain-days']) {
      this.apply('young_domain');
    }
  }

  readSpf(outcome: ProviderOutcome<TxtAnswer> | undefined): void {
    if (outcome?.kind !== 'result') {
      this.unknown(
        'email-spf-policy',
        outcome?.kind === 'error' ? 'execution_error' : 'provider_not_configured',
      );
      return;
    }
    const reading =
      outcome.result.kind === 'none'
        ? { policy: 'no_record' as const, redirect: false }
        : readSpfPolicy(outcome.result.records);
    this.set('email-spf-policy', reading.policy);
    this.details = { ...this.details, 'spf-redirect': reading.redirect };
  }

  readDmarc(outcome: EmailAddressReportInput['dmarc']): void {
    if (outcome === undefined || outcome.kind === 'not_configured') {
      this.unknown('email-dmarc-policy', 'provider_not_configured');
      return;
    }
    if (outcome.kind !== 'reading') {
      this.unknown(
        'email-dmarc-policy',
        outcome.kind === 'error' ? 'execution_error' : 'undetermined',
      );
      this.details = { ...this.details, 'dmarc-queries': outcome.queries };
      return;
    }
    const { reading } = outcome;
    this.set('email-dmarc-policy', reading.policy);
    this.details = {
      ...this.details,
      'dmarc-found-at': reading.foundAt,
      'dmarc-testing': reading.testing,
      'dmarc-queries': reading.queries,
    };
  }

  /** The band: the worst reached, unless a blocked check could reach a worse one. */
  finish(): Fields {
    const reached = (band: EmailBand) =>
      [...this.#applied].filter((reason) => REASON_BANDS[reason]?.[0] === band);
    const blockedAt = (band: 'low' | 'medium') =>
      this.#blocked.filter((blocked) => blocked.band === band).map(({ cause }) => cause);
    if (this.#relay) {
      this.apply('privacy_relay');
      return this.withoutBand('undetermined');
    }
    const low = reached('low');
    if (low.length > 0) {
      return this.withBand('low', low);
    }
    const lowBlocked = blockedAt('low');
    if (lowBlocked.length > 0) {
      return this.withoutBand(causeOf(lowBlocked));
    }
    const medium = reached('medium');
    if (medium.length > 0) {
      return this.withBand('medium', medium);
    }
    const mediumBlocked = blockedAt('medium');
    if (mediumBlocked.length > 0) {
      return this.withoutBand(causeOf(mediumBlocked));
    }
    if (this.#accepts === true) {
      this.apply('accepts_mail');
      return this.withBand('high', ['accepts_mail']);
    }
    return this.withoutBand('undetermined');
  }

  withBand(band: EmailBand, reasons: readonly EmailBandReason[]): Fields {
    this.set('email-reputation', band);
    this.set('email-is-suspicious', band === 'low');
    this.set('email-reputation-confidence', Math.max(...reasons.map(confidenceOf)));
    this.set('email-reputation-reasons', this.reasons());
    return this.fields;
  }

  withoutBand(cause: RiskUnavailableReason): Fields {
    if (cause === 'execution_error') {
      this.apply('execution_error');
    }
    for (const field of BAND_FIELDS) {
      this.unknown(field, cause);
    }
    this.set('email-reputation-reasons', this.reasons());
    return this.fields;
  }

  reasons(): EmailBandReason[] {
    return EMAIL_BAND_REASONS.filter((reason) => this.#applied.has(reason));
  }

  confidences(): Partial<Record<EmailBandReason, number>> {
    return Object.fromEntries(
      this.reasons()
        .filter((reason) => REASON_BANDS[reason] !== undefined)
        .map((reason) => [reason, confidenceOf(reason)]),
    );
  }

  unavailableFields(): UnavailableField[] {
    return FIELD_ORDER.flatMap((field) => {
      const reason = this.#missing.get(field);
      return reason === undefined ? [] : [{ field, reason }];
    });
  }
}

function confidenceOf(reason: EmailBandReason): number {
  const entry = REASON_BANDS[reason];
  return entry === undefined ? 0 : riskConstant(entry[1]);
}

function causeOf(causes: readonly RiskUnavailableReason[]): RiskUnavailableReason {
  return CAUSE_ORDER.find((cause) => causes.includes(cause)) ?? 'undetermined';
}

/** An MX answer naming no exchange at all: the resolver should have said NODATA. */
const isEmptyMx = (result: MxLookupResult) => result.kind === 'mx' && result.exchanges.length === 0;
