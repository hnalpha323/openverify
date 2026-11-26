/**
 * C52.2, C54.1: what a Phase 5 verification's flow view adds, one hook per type
 * (`services/guidance/<api-type>.ts`): `guidance` (nullable) tells the client how to run the step,
 * from the inquiry's pinned step and configuration and the verification's state, and the form
 * types add `inputs-received`. A flow view never carries checks or an entered value.
 *
 * `flowVerificationResource` (`services/resources.ts`) calls the hook of the verification's type;
 * a government ID and a selfie add nothing (their capture guidance comes with their sub-resources).
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import type { VerificationTemplateConfig } from '@openverify/core';
import type { Db, VerificationWithChecks } from '@openverify/db';
import type { FlowStep } from '@openverify/flow-spec';
import type { Phase5VerificationType } from '../attributes/index.js';
import type { ApiDependencies } from '../context.js';
import { aamvaGuidance } from './aamva.js';
import { businessWebsiteGuidance } from './business-website.js';
import { cryptoWalletGuidance } from './crypto-wallet.js';
import { databaseBusinessGuidance } from './database-business.js';
import { databaseGuidance } from './database.js';
import { documentGuidance } from './document.js';
import { emailAddressGuidance } from './email-address.js';
import { governmentIdNfcGuidance } from './government-id-nfc.js';
import { phoneNumberGuidance } from './phone-number.js';

/** What a guidance hook reads. */
export interface FlowGuidanceContext {
  deps: ApiDependencies;
  /** The request's database, or the transaction that answers. */
  db: Db;
  verification: VerificationWithChecks;
  /** The type's step in the inquiry's pinned flow (`stepForVerificationType`), if any. */
  step: FlowStep | undefined;
  /** The type's configuration in the inquiry's pinned version, if any. */
  config: VerificationTemplateConfig | undefined;
}

/** One type's flow attributes (C52.2). */
export interface VerificationGuidanceHook {
  /** `guidance` and, for the form types, `inputs-received`; never an entered value. */
  flowAttributes(ctx: FlowGuidanceContext): Promise<Readonly<Record<string, unknown>>>;
}

export const VERIFICATION_GUIDANCE_HOOKS: Readonly<
  Record<Phase5VerificationType, VerificationGuidanceHook>
> = Object.freeze({
  document: documentGuidance,
  database: databaseGuidance,
  aamva: aamvaGuidance,
  phone_number: phoneNumberGuidance,
  email_address: emailAddressGuidance,
  government_id_nfc: governmentIdNfcGuidance,
  crypto_wallet: cryptoWalletGuidance,
  database_business: databaseBusinessGuidance,
  business_website: businessWebsiteGuidance,
});

/** The hook of `type`, or `undefined` for a government ID or a selfie. */
export function guidanceHookFor(
  type: SupportedVerificationType,
): VerificationGuidanceHook | undefined {
  return type === 'government_id' || type === 'selfie'
    ? undefined
    : VERIFICATION_GUIDANCE_HOOKS[type];
}
