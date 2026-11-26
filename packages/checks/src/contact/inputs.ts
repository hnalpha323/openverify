/**
 * What the contact evaluators read (C55, C56): typed objects `api-otp` builds from the
 * verification, its OTP state (C53.2 `otp_verification_states` and the confirmed challenge), the
 * sender that delivered its codes, the disposable list the API image carries and the MX lookup.
 * The phone number and email address are read, never copied into a result (C51.4).
 */
import type { CheckModel, CheckProvider } from '@openverify/core';
import type { EnvironmentKind } from '../data/feature-table.js';
import type { ProviderOutcome } from '../government-id/inputs.js';

/** C53.2 `otp_verification_states.limited_reason`: which limit refused the user (C55.6). */
export const OTP_LIMITED_REASONS = Object.freeze([
  'destination',
  'inquiry',
  'guess',
  'environment',
  'store_unavailable',
] as const);
export type OtpLimitedReason = (typeof OTP_LIMITED_REASONS)[number];

/** A verification's OTP state when it was submitted (C55.5, C55.6). */
export interface OtpCheckState {
  /**
   * The verification holds a `confirmed` challenge for its own destination (C55.4): the user
   * entered the code sent there.
   */
  confirmed: boolean;
  /** Accepted sends; an errored send does not count (C55.6). */
  sends: number;
  /** Wrong entries across the verification's codes (C55.5); a new code never resets it. */
  wrongEntries: number;
  /** The wrong entries that submit the verification (C55.5 `OTP_MAX_WRONG_ENTRIES`, 10). */
  maxWrongEntries: number;
  /** The limit that refused the user (C55.6 `limited_at`), or `null`. */
  limitedReason: OtpLimitedReason | null;
}

/** `phone_number_otp_comparison` (C56). */
export interface PhoneNumberCheckInput {
  /** The verification's destination in E.164, or `null` when none was ever entered. */
  phoneNumber: string | null;
  /** Its OTP state, or `null` when the verification has none. */
  otp: OtpCheckState | null;
  /** The SMS sender that delivered its codes (`sandbox: true` for the sandbox sender). */
  sender: CheckProvider | null;
}

/** The disposable-email list the API loaded (C56): its domains and which file it was. */
export interface DisposableDomainList {
  /** Lower-case ASCII domains ({@link parseDisposableDomainList}). */
  domains: ReadonlySet<string>;
  /**
   * The file's identity and SHA-256, recorded as the result's `models` entry: the
   * `data/manifest.json` name and commit (`disposable-email-domains@6fcca80`) and the digest.
   */
  source: CheckModel;
}

/**
 * C56: what a DNS lookup of the email domain found. `mx` lists the exchange host names (a null MX
 * is the empty name or `.`, RFC 7505); `no_mx` is a NODATA answer for MX, with the count of the
 * domain's own A and AAAA records (the RFC 5321 §5.1 implicit MX); `not_found` is NXDOMAIN.
 * Timeouts and server failures are the outcome's `error` after the resolver's retries.
 */
export type MxLookupResult =
  | { kind: 'mx'; exchanges: readonly string[] }
  | { kind: 'no_mx'; addressRecords: number }
  | { kind: 'not_found' };

/** The email address checks (C56). */
export interface EmailAddressCheckInput {
  /** The verification's destination, or `null` when none was ever entered. */
  emailAddress: string | null;
  /** Its OTP state, or `null` when the verification has none. */
  otp: OtpCheckState | null;
  /** The mailer that delivered its codes. */
  sender: CheckProvider | null;
  /** The disposable list, or `null` (or absent) when the API image has no list file. */
  disposableList?: DisposableDomainList | null | undefined;
  /**
   * The MX lookup of the address's domain (`not_configured` without a resolver); absent when the
   * job made none. A sandbox environment's reserved domains need none
   * (`sandboxMailDomainRule`).
   */
  mx?: ProviderOutcome<MxLookupResult> | undefined;
  /** The environment kind; `production` when absent. */
  environment?: EnvironmentKind | undefined;
}
