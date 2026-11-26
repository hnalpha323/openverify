/**
 * C54.5: each Phase 5 verification type's reason words, one module per type
 * (`lib/reason-words/<type>.ts`), keyed by the type's resource type. `reasonText` consults the
 * module of a check's type before the shared words (`check-reasons.ts`).
 */
import { toVerificationResourceType, type VerificationResourceType } from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import type { ReasonText } from '../check-reasons';
import { AAMVA_REASON_WORDS } from './aamva';
import { BUSINESS_WEBSITE_REASON_WORDS } from './business-website';
import { CRYPTO_WALLET_REASON_WORDS } from './crypto-wallet';
import { DATABASE_REASON_WORDS } from './database';
import { DATABASE_BUSINESS_REASON_WORDS } from './database-business';
import { DOCUMENT_REASON_WORDS } from './document';
import { EMAIL_ADDRESS_REASON_WORDS } from './email-address';
import { GOVERNMENT_ID_NFC_REASON_WORDS } from './government-id-nfc';
import { PHONE_NUMBER_REASON_WORDS } from './phone-number';
import type { ReasonWords } from './types';

export type { ReasonWords } from './types';

/** The Phase 5 resource types, whose checks' words live in a module per type. */
export type Phase5ResourceType = Exclude<
  VerificationResourceType,
  'verification/government-id' | 'verification/selfie'
>;

export const PHASE5_REASON_WORDS: Readonly<Record<Phase5ResourceType, ReasonWords>> = Object.freeze(
  {
    'verification/document': DOCUMENT_REASON_WORDS,
    'verification/database': DATABASE_REASON_WORDS,
    'verification/aamva': AAMVA_REASON_WORDS,
    'verification/phone-number': PHONE_NUMBER_REASON_WORDS,
    'verification/email-address': EMAIL_ADDRESS_REASON_WORDS,
    'verification/government-id-nfc': GOVERNMENT_ID_NFC_REASON_WORDS,
    'verification/crypto-wallet': CRYPTO_WALLET_REASON_WORDS,
    'verification/database-business': DATABASE_BUSINESS_REASON_WORDS,
    'verification/business-website': BUSINESS_WEBSITE_REASON_WORDS,
  },
);

/**
 * The words the module of `checkName`'s verification type gives `code`, or `undefined` for a
 * check the registry does not know, a type without a module, or a code it does not word. Own
 * properties only, so a code such as `constructor` never reaches `Object.prototype`.
 */
export function typeReasonText(code: string, checkName: string): ReasonText | undefined {
  const type = getCheckDefinition(checkName)?.verificationType;
  if (type === undefined) {
    return undefined;
  }
  const resourceType = toVerificationResourceType(type);
  const words = Object.hasOwn(PHASE5_REASON_WORDS, resourceType)
    ? PHASE5_REASON_WORDS[resourceType as Phase5ResourceType]
    : undefined;
  return words !== undefined && Object.hasOwn(words, code) ? words[code] : undefined;
}
