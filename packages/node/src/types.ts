/**
 * Named types for the resources the client returns, and helpers for the Phase 3 government ID
 * surface: the verification statuses (with `needs_review`, C30.4), each check's stage, confidence
 * and provenance (C29.2), and a government ID's extracted fields and their sources (C31.5).
 *
 * The extracted fields are PII. They are `null` when not read, masked (`null`) for an API key
 * minted masked, and `null` after redaction; `extraction-sources` names fields and sources only.
 */
import type { z } from 'zod';
import {
  CONNECT_EVENT_NAMES,
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  type accountExportManifestSchema,
  type accountExportResourceSchema,
  type connectionResourceSchema,
  type consentRecordResourceSchema,
  type shareTokenResourceSchema,
  type InquiryResource,
  type SelfieCaptureResource,
  type VerificationCheck,
  type VerificationResource,
} from '@openverify/contracts';

export type { InquiryResource, VerificationCheck, VerificationResource };

/** C40.1: a selfie capture (`GET /api/v1/selfies/:id`, `?include=selfies`, `selfie.*` events). */
export type SelfieCapture = SelfieCaptureResource;

/** C40.1: `initiated`, `submitted`, `processed` or `errored`. */
export type SelfieCaptureStatus = SelfieCapture['attributes']['status'];

/** A selfie verification, with the C40.10 scores and the capture's method, liveness and poses. */
export type SelfieVerification = Extract<VerificationResource, { type: 'verification/selfie' }>;

/** A verification's status: `needs_review` waits for an operator (C30.4). */
export type VerificationStatus = VerificationResource['attributes']['status'];

/** An inquiry's status. */
export type InquiryStatus = InquiryResource['attributes']['status'];

/** A check's stage when its result was written: `ga`, `beta` or `sunset` (C29.2). */
export type CheckStage = NonNullable<VerificationCheck['stage']>;

/** What a result was judged with (C29.2): version, models, provider and thresholds. */
export type CheckProvenance = NonNullable<VerificationCheck['provenance']>;

/** A C31.5 extraction attribute name, such as `name-last` or `identification-number`. */
export type ExtractionField = (typeof GOVERNMENT_ID_EXTRACTION_ATTRIBUTES)[number];

/** A government ID verification resource (`verification/government-id`). */
export type GovernmentIdVerification = Extract<
  VerificationResource,
  { type: 'verification/government-id' }
>;

/** Where an extracted value was read: `mrz`, `barcode`, `viz` (the printed text) or `nfc`. */
export type ExtractionSource = NonNullable<
  NonNullable<GovernmentIdVerification['attributes']['extraction-sources']>[ExtractionField]
>[number];

/** The C31.5 extraction attributes of a government ID, in their API order. */
export const EXTRACTION_ATTRIBUTES: readonly ExtractionField[] =
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES;

/** A government ID's extraction as one object: every field (`null` when not read) and its sources. */
export interface GovernmentIdExtraction {
  fields: Readonly<Record<ExtractionField, string | null>>;
  /** Per field, the sources that agreed (`mrz`, `barcode`, `viz`, `nfc`). */
  sources: Readonly<Partial<Record<ExtractionField, readonly ExtractionSource[]>>>;
}

/** Whether `resource` is a government ID verification. */
export function isGovernmentIdVerification(
  resource: VerificationResource,
): resource is GovernmentIdVerification {
  return resource.type === 'verification/government-id';
}

/** The extraction of a government ID verification: its fields, and the sources that agreed. */
export function extractionOf(verification: GovernmentIdVerification): GovernmentIdExtraction {
  const { attributes } = verification;
  return {
    fields: Object.fromEntries(
      EXTRACTION_ATTRIBUTES.map((field) => [field, attributes[field] ?? null]),
    ) as Record<ExtractionField, string | null>,
    sources: attributes['extraction-sources'] ?? {},
  };
}

/** C50.6: a verification resource type. */
export type VerificationResourceType = VerificationResource['type'];

/** A verification resource of one type. */
export type VerificationOf<Type extends VerificationResourceType> = Extract<
  VerificationResource,
  { type: Type }
>;

/** C51.1: a check's category: `biometrics`, `fraud`, `user_action_required` or `validity`. */
export type CheckCategory = NonNullable<VerificationCheck['category']>;

/** C50.1: a document verification (`verification/document`). */
export type DocumentVerification = VerificationOf<'verification/document'>;
/** C50.1: a database verification (`verification/database`). */
export type DatabaseVerification = VerificationOf<'verification/database'>;
/** C50.1: an AAMVA verification (`verification/aamva`). */
export type AamvaVerification = VerificationOf<'verification/aamva'>;
/** C50.1: a phone number verification (`verification/phone-number`). */
export type PhoneNumberVerification = VerificationOf<'verification/phone-number'>;
/** C50.1: an email address verification (`verification/email-address`). */
export type EmailAddressVerification = VerificationOf<'verification/email-address'>;
/** C50.1: an NFC government ID verification (`verification/government-id-nfc`). */
export type GovernmentIdNfcVerification = VerificationOf<'verification/government-id-nfc'>;
/** C50.1: a crypto wallet verification (`verification/crypto-wallet`). */
export type CryptoWalletVerification = VerificationOf<'verification/crypto-wallet'>;
/** C50.1: a business registry verification (`verification/database-business`). */
export type DatabaseBusinessVerification = VerificationOf<'verification/database-business'>;
/** C50.1: a business website verification (`verification/business-website`). */
export type BusinessWebsiteVerification = VerificationOf<'verification/business-website'>;

/**
 * Whether `resource` is a verification of `type`, such as `verification/document`; narrows it
 * to that type's attributes.
 */
export function isVerificationOfType<Type extends VerificationResourceType>(
  resource: VerificationResource,
  type: Type,
): resource is VerificationOf<Type> {
  return resource.type === type;
}

/** C230-C237 (Workflow 11A): a Connect connection as the caller's side sees it. */
export type Connection = z.output<typeof connectionResourceSchema>;
/** A share token as the caller's side sees it (outbound or inbound, C232.3). */
export type ShareToken = z.output<typeof shareTokenResourceSchema>;
/** A consent record (flow-witnessed or attested, C236). */
export type ConsentRecord = z.output<typeof consentRecordResourceSchema>;
/** C253 (Workflow 11B): an account's access export. */
export type AccountExport = z.output<typeof accountExportResourceSchema>;
/** C253.3: the `openverify.account-export.v1` manifest of a ready export. */
export type AccountExportManifest = z.output<typeof accountExportManifestSchema>;
/** C239.1: the name of a Connect event (connection, share token or consent record). */
export type ConnectEventName = (typeof CONNECT_EVENT_NAMES)[number];

const CONNECT_EVENTS: ReadonlySet<string> = new Set(CONNECT_EVENT_NAMES);

/** Whether a webhook event's name is a Connect event (C239.1). */
export function isConnectEventName(name: string): name is ConnectEventName {
  return CONNECT_EVENTS.has(name);
}
