/**
 * C54.1: what a verification's sub-resources do when it is canceled, one hook per type
 * (`services/sub-resources/<api-type>.ts`): a selfie's open capture errors (C40.2), an open OTP
 * code or wallet challenge is superseded, and so on. Every cancel path calls them in the
 * transaction that cancels, after the verification is locked (C40.6): the inquiry's expiry and
 * actions (`cancelInitiatedVerifications`), and a type's own cap (the 11th capture or challenge).
 * A hook returns the events it staged and the objects to delete once the transaction committed.
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import type { Db, Verification } from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { aamvaSubResources } from './aamva.js';
import { businessWebsiteSubResources } from './business-website.js';
import { cryptoWalletSubResources } from './crypto-wallet.js';
import { databaseBusinessSubResources } from './database-business.js';
import { databaseSubResources } from './database.js';
import { documentSubResources } from './document.js';
import { emailAddressSubResources } from './email-address.js';
import { governmentIdNfcSubResources } from './government-id-nfc.js';
import { governmentIdSubResources } from './government-id.js';
import { phoneNumberSubResources } from './phone-number.js';
import { selfieSubResources } from './selfie.js';

/** What canceling a verification's sub-resources left to do after commit. */
export interface CanceledSubResources {
  staged: StagedEvent[];
  /** Objects of the file rows it deleted, to delete once the transaction committed. */
  storageKeys: string[];
}

/** One type's sub-resources (C54.1). */
export interface SubResourceHook {
  onVerificationCanceled(
    tx: Db,
    events: TransactionalEventPublisher,
    verification: Verification,
  ): Promise<CanceledSubResources>;
}

export const SUB_RESOURCE_HOOKS: Readonly<Record<SupportedVerificationType, SubResourceHook>> =
  Object.freeze({
    government_id: governmentIdSubResources,
    selfie: selfieSubResources,
    document: documentSubResources,
    database: databaseSubResources,
    aamva: aamvaSubResources,
    phone_number: phoneNumberSubResources,
    email_address: emailAddressSubResources,
    government_id_nfc: governmentIdNfcSubResources,
    crypto_wallet: cryptoWalletSubResources,
    database_business: databaseBusinessSubResources,
    business_website: businessWebsiteSubResources,
  });

/** Runs the cancel hook of `verification`'s type in `tx`. */
export function cancelSubResources(
  tx: Db,
  events: TransactionalEventPublisher,
  verification: Verification,
): Promise<CanceledSubResources> {
  return SUB_RESOURCE_HOOKS[verification.type].onVerificationCanceled(tx, events, verification);
}
