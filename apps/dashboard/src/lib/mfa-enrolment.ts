/** What the account security page shows and its actions answer (C22). Client-safe. */
import type { MfaFactorKind, MfaFactorResource, MfaFactorStatus } from '@openverify/contracts';

/** A pending TOTP factor with its secret, shown once (C15). */
export interface TotpEnrolmentData {
  readonly factorId: string;
  readonly secret: string;
  readonly otpauthUri: string;
  /** The `otpauth://` URI as a QR code, drawn on the server (`lib/qr.ts`). */
  readonly qr: { readonly size: number; readonly path: string };
}

/** An activated factor: the first one comes with 10 recovery codes, shown once. */
export interface FactorActivated {
  readonly recoveryCodes: readonly string[] | null;
}

/** A factor as the page lists it. */
export interface FactorSummary {
  readonly id: string;
  readonly kind: MfaFactorKind;
  readonly name: string | null;
  readonly status: MfaFactorStatus;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export function toFactorSummary(factor: MfaFactorResource): FactorSummary {
  return {
    id: factor.id,
    kind: factor.attributes.kind,
    name: factor.attributes.name,
    status: factor.attributes.status,
    createdAt: factor.attributes['created-at'],
    lastUsedAt: factor.attributes['last-used-at'],
  };
}
