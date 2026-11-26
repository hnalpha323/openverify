/**
 * The email domain evidence as the console shows it (C56, C66), read from the email address
 * verification's own check results: what the disposable-domain check matched and how far above
 * the address, and how the mail-domain (MX) check found its answer and how many records it read.
 * Metadata is `unknown` in the contract, so a value of the wrong shape counts as not recorded.
 */
import type { VerificationCheck } from '@openverify/contracts';
import { metadataString, type EmailAddressVerification } from './otp-evidence';

export interface DisposableEvidence {
  /** `none`, `listed`, `denied` or `allowed`. */
  readonly match: string;
  /** How many labels above the address's own domain the match was; `null` without a match. */
  readonly depth: number | null;
}

export interface MxEvidence {
  /** `mx`, `null_mx`, `implicit`, `nxdomain` or `reserved`. */
  readonly route: string;
  readonly recordCount: number | null;
}

export interface EmailDomainEvidence {
  /** `null` before the disposable check ran, or when it recorded no match. */
  readonly disposable: DisposableEvidence | null;
  /** `null` before the MX check ran, or when it recorded no route. */
  readonly mx: MxEvidence | null;
}

/** A whole number from 0 in `metadata`, else `null`. */
function count(metadata: VerificationCheck['metadata'], key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function emailDomainEvidenceOf(verification: EmailAddressVerification): EmailDomainEvidence {
  const metadataOf = (name: string) =>
    verification.attributes.checks.find((check) => check.name === name)?.metadata ?? {};
  const disposable = metadataOf('email_address_disposable_detection');
  const mx = metadataOf('email_address_mx_detection');
  const match = metadataString(disposable, 'match');
  const route = metadataString(mx, 'route');
  return {
    disposable: match === null ? null : { match, depth: count(disposable, 'match-depth') },
    mx: route === null ? null : { route, recordCount: count(mx, 'record-count') },
  };
}
