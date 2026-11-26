/**
 * C54.5: the evidence component of each Phase 5 verification type, one file per type
 * (`components/evidence/<type>.tsx`). Workflow 5A Stage 1b made each a placeholder that
 * re-exports the generic view; the Workflow 5C console agents replace their own types' files
 * (`dashboard-people`: phone, email, crypto; `dashboard-records`: database, AAMVA, business
 * registry, business website; `dashboard-documents`: document, chip) and never this one.
 */
import type { VerificationResource } from '@openverify/contracts';
import { createElement, type ComponentType } from 'react';
import { AamvaEvidence } from './aamva';
import { BusinessWebsiteEvidence } from './business-website';
import { CryptoWalletEvidence } from './crypto-wallet';
import { DatabaseEvidence } from './database';
import { DatabaseBusinessEvidence } from './database-business';
import { DocumentEvidence } from './document';
import { EmailAddressEvidence } from './email-address';
import type { EvidenceProps, Phase5Verification } from './generic';
import { GovernmentIdNfcEvidence } from './government-id-nfc';
import { PhoneNumberEvidence } from './phone-number';

export type { EvidenceProps, EvidenceState, Phase5Verification } from './generic';

/** Each Phase 5 resource type's evidence component. */
export const EVIDENCE_COMPONENTS: Readonly<
  Record<Phase5Verification['type'], ComponentType<EvidenceProps>>
> = Object.freeze({
  'verification/document': DocumentEvidence,
  'verification/database': DatabaseEvidence,
  'verification/aamva': AamvaEvidence,
  'verification/phone-number': PhoneNumberEvidence,
  'verification/email-address': EmailAddressEvidence,
  'verification/government-id-nfc': GovernmentIdNfcEvidence,
  'verification/crypto-wallet': CryptoWalletEvidence,
  'verification/database-business': DatabaseBusinessEvidence,
  'verification/business-website': BusinessWebsiteEvidence,
});

/** Whether `verification` is of a Phase 5 type, which has an evidence component. */
export function isPhase5Verification(
  verification: VerificationResource,
): verification is Phase5Verification {
  return Object.hasOwn(EVIDENCE_COMPONENTS, verification.type);
}

/** The evidence of a Phase 5 verification, through its type's component. */
export function VerificationEvidence(props: EvidenceProps) {
  return createElement(EVIDENCE_COMPONENTS[props.verification.type], props);
}
