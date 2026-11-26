/**
 * C52.8, C54.1: the type attributes of the Phase 5 verification resources, one hook per type
 * (`services/attributes/<api-type>.ts`). `load` reads the attributes a type stores, unmasked;
 * `mask` hides the PII ones from a principal that may not see them (C53.7). Every exit that
 * serves a verification goes through {@link loadVerificationAttributes} and the resource builder:
 * `GET /verifications/:id`, `?include=verifications`, the dashboard inquiry document and the
 * `verification.*` event payloads, which the Events API and stored API logs mask in turn.
 *
 * A government ID's and a selfie's attributes come from their extraction and captures (C31.5,
 * C40.10), so they have no hook here.
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import type { Db, VerificationWithChecks } from '@openverify/db';
import type { PiiMask } from '../../auth/pii.js';
import { aamvaAttributes } from './aamva.js';
import { businessWebsiteAttributes } from './business-website.js';
import { cryptoWalletAttributes } from './crypto-wallet.js';
import { databaseBusinessAttributes } from './database-business.js';
import { databaseAttributes } from './database.js';
import { documentAttributes } from './document.js';
import { emailAddressAttributes } from './email-address.js';
import { governmentIdNfcAttributes } from './government-id-nfc.js';
import { phoneNumberAttributes } from './phone-number.js';

/** The verification types Phase 5 adds. */
export type Phase5VerificationType = Exclude<SupportedVerificationType, 'government_id' | 'selfie'>;

/** One type's attributes (C52.8). */
export interface VerificationAttributeHook {
  /**
   * The type's attributes as stored, unmasked: a member it cannot know yet is `null` or absent,
   * and a redacted one `null`. Reads with `db` (the request's database or the transaction that
   * stages an event).
   */
  load(db: Db, verification: VerificationWithChecks): Promise<Readonly<Record<string, unknown>>>;
  /** The attributes as `mask` lets its principal see them (C53.7). */
  mask(attributes: Readonly<Record<string, unknown>>, mask: PiiMask): Readonly<Record<string, unknown>>;
}

export const VERIFICATION_ATTRIBUTE_HOOKS: Readonly<
  Record<Phase5VerificationType, VerificationAttributeHook>
> = Object.freeze({
  document: documentAttributes,
  database: databaseAttributes,
  aamva: aamvaAttributes,
  phone_number: phoneNumberAttributes,
  email_address: emailAddressAttributes,
  government_id_nfc: governmentIdNfcAttributes,
  crypto_wallet: cryptoWalletAttributes,
  database_business: databaseBusinessAttributes,
  business_website: businessWebsiteAttributes,
});

/** The hook of `type`, or `undefined` for a government ID or a selfie. */
export function attributeHookFor(
  type: SupportedVerificationType,
): VerificationAttributeHook | undefined {
  return type === 'government_id' || type === 'selfie'
    ? undefined
    : VERIFICATION_ATTRIBUTE_HOOKS[type];
}

/** The unmasked type attributes of `verification`, or `undefined` for a type without a hook. */
export async function loadVerificationAttributes(
  db: Db,
  verification: VerificationWithChecks,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  return attributeHookFor(verification.type)?.load(db, verification);
}

/**
 * Loads the type attributes of several verifications, by id; types without a hook are absent.
 */
export async function loadVerificationAttributesOf(
  db: Db,
  verifications: readonly VerificationWithChecks[],
): Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>> {
  const loaded = new Map<string, Readonly<Record<string, unknown>>>();
  for (const verification of verifications) {
    const attributes = await loadVerificationAttributes(db, verification);
    if (attributes !== undefined) {
      loaded.set(verification.id, attributes);
    }
  }
  return loaded;
}
