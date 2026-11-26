/**
 * The type attributes of the Phase 5 verification resources (C52.8) and the members their flow
 * views add (C52.2).
 *
 * Full resources (server and dashboard APIs, `verification.*` events; never the flow API): every
 * member is optional, so an answer from a server before the type's attribute hook still parses,
 * and nullable. Each PII member is marked `.meta({ pii: true })`; `PII_VERIFICATION_ATTRIBUTES` is
 * built from the marks and drives masking (C53.7): masked for API keys minted `pii-masked` and
 * users without `pii:view`, `null` after redaction. The nested PII objects are masked like
 * inquiry `fields`: `fields` member-wise, `associated-persons` whole.
 *
 * Flow views: `guidance` (nullable) tells the client how to run the step; the form types add
 * `inputs-received`. A flow view never carries checks or an entered value.
 */
import {
  CHECK_STATUSES,
  DOCUMENT_TYPES,
  cryptoChainIdSchema,
  cryptoSignatureSchemeSchema,
  extractedFieldsSchema,
  idClassSchema,
} from '@openverify/core';
import { AAMVA_SOURCES, CRYPTO_SIGNING_METHODS, countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { ACCEPTED_IMAGE_MIME_TYPES } from './files.js';
import { SANDBOX_CHIP_LABEL_MEMBER, sandboxChipScenarioSchema } from './flow-nfc.js';
import { timestampSchema } from './json-api.js';
import { OTP_CODE_LENGTH, OTP_MAX_ATTEMPTS_PER_CODE, OTP_MAX_SENDS } from './otp.js';
import {
  aamvaInputsSchema,
  associatedPersonInputSchema,
  databaseBusinessInputsSchema,
  databaseInputsSchema,
} from './verification-inputs.js';

/** A PII member: nullable, optional, and marked for masking (C53.7). */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().optional().meta({ pii: true });
}

/** A member that is not PII: nullable and optional. */
function plain<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().optional();
}

const text = (max: number) => z.string().min(1).max(max);
const count = z.int().min(0);

// Phone and email (C55) --------------------------------------------------------------------------

const otpAttributes = {
  /** When the code was accepted; `null` until then. */
  'confirmed-at': plain(timestampSchema),
  /** Accepted sends; an errored send does not count. */
  sends: plain(count),
  /** Wrong entries across the verification's codes (C55.5). */
  'failed-attempts': plain(count),
};

export const PHONE_NUMBER_VERIFICATION_ATTRIBUTES = {
  /** E.164. Never the code: `confirmation-code` is never exposed (C50.9). */
  'phone-number': pii(text(32)),
  ...otpAttributes,
};

export const EMAIL_ADDRESS_VERIFICATION_ATTRIBUTES = {
  'email-address': pii(text(254)),
  ...otpAttributes,
};

// Document (C60) ---------------------------------------------------------------------------------

/** The document classes, and what the classifier answers when none is established (C60.5). */
export const DOCUMENT_CLASSIFICATIONS = [...DOCUMENT_TYPES, 'other', 'unknown'] as const;

/** C52.8: the document's extracted values, PII, masked member-wise. */
export const documentFieldsSchema = z.strictObject({
  name: text(200).nullable().optional(),
  'address-street-1': text(200).nullable().optional(),
  'address-street-2': text(200).nullable().optional(),
  'address-city': text(100).nullable().optional(),
  'address-subdivision': text(100).nullable().optional(),
  'address-postal-code': text(20).nullable().optional(),
  'address-country-code': countryCodeSchema.nullable().optional(),
  'issue-date': z.iso.date().nullable().optional(),
  issuer: text(200).nullable().optional(),
  'expiration-date': z.iso.date().nullable().optional(),
});

/** The media types a document may be (C52.4): images and PDF. */
export const DOCUMENT_MIME_TYPES = [...ACCEPTED_IMAGE_MIME_TYPES, 'application/pdf'] as const;

export const DOCUMENT_VERIFICATION_ATTRIBUTES = {
  'document-type': plain(z.enum(DOCUMENT_CLASSIFICATIONS)),
  /** The top class probability, uncalibrated (C60.6). */
  'document-type-confidence': plain(z.number().min(0).max(1)),
  'page-count': plain(z.int().min(1).max(50)),
  'mime-type': plain(z.enum(DOCUMENT_MIME_TYPES)),
  fields: pii(documentFieldsSchema),
};

// Database and AAMVA (C59) -----------------------------------------------------------------------

const isoDate = z.iso.date();
const name = text(200);
const e164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'must be an E.164 phone number');

/** The entered values as the database body (C52.3), PII. */
export const DATABASE_VERIFICATION_ATTRIBUTES = {
  'name-first': pii(name),
  'name-middle': pii(name),
  'name-last': pii(name),
  birthdate: pii(isoDate),
  'address-street-1': pii(text(200)),
  'address-street-2': pii(text(200)),
  'address-city': pii(text(100)),
  'address-subdivision': pii(text(100)),
  'address-postal-code': pii(text(20)),
  'address-country-code': pii(countryCodeSchema),
  'identification-number': pii(text(64)),
  'phone-number': pii(e164),
  'email-address': pii(z.email().max(254)),
};

/** The entered values as the AAMVA form (C52.3), PII, and where they came from. */
export const AAMVA_VERIFICATION_ATTRIBUTES = {
  /** Whether the server read the inquiry's licence or the user filled the form (C59.6). */
  source: plain(z.enum(AAMVA_SOURCES)),
  'name-first': pii(name),
  'name-last': pii(name),
  birthdate: pii(isoDate),
  'identification-number': pii(text(64)),
  'issuing-authority': pii(aamvaInputsSchema.shape['issuing-authority']),
  'issue-date': pii(isoDate),
  'expiration-date': pii(isoDate),
  'address-postal-code': pii(text(10)),
};

// Crypto wallet (C57) ----------------------------------------------------------------------------

export const CRYPTO_WALLET_VERIFICATION_ATTRIBUTES = {
  'wallet-address': pii(text(128)),
  /** The inquiry field `crypto_wallet_address` the address had to equal (C57.2). */
  'expected-address': pii(text(128)),
  'chain-id': plain(cryptoChainIdSchema),
  'signature-scheme': plain(cryptoSignatureSchemeSchema),
};

// Business registry and website (C61) -------------------------------------------------------------

/** The business registry an answer came from (C61.1). */
export const BUSINESS_REGISTRY_SOURCES = [
  'gleif',
  'companies-house',
  'sec-edgar',
  'sandbox',
] as const;

export const DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES = {
  /** A sole trader's name, so PII. */
  'business-name': pii(text(300)),
  'registration-number': plain(text(20)),
  lei: plain(z.string().length(20)),
  'address-street-1': pii(text(200)),
  'address-street-2': pii(text(200)),
  'address-city': pii(text(100)),
  'address-subdivision': pii(text(100)),
  'address-postal-code': pii(text(20)),
  'address-country-code': pii(countryCodeSchema),
  /** Masked whole. */
  'associated-persons': pii(z.array(associatedPersonInputSchema)),
  'registry-record-id': plain(text(100)),
  /** A sole trader's name, so PII. */
  'registry-legal-name': pii(text(300)),
  'registry-source': plain(z.enum(BUSINESS_REGISTRY_SOURCES)),
  /** The source's own status value, such as `ISSUED` or `active` (C61.2). */
  'registry-status': plain(text(64)),
};

export const BUSINESS_WEBSITE_VERIFICATION_ATTRIBUTES = {
  /** A personal site's address can name its owner, so PII. */
  'website-url': pii(text(2048)),
  'website-domain': pii(text(253)),
  /** From RDAP, for the registered domain only (C61.4). */
  'domain-registered-at': plain(timestampSchema),
};

// Government ID NFC (C62) --------------------------------------------------------------------------

/** C62.2: whether the chip data's integrity was established, broken, or neither. */
export const CHIP_INTEGRITY_OUTCOMES = ['established', 'broken', 'not_established'] as const;
/** C62.2: what revocation checking found. */
export const CHIP_REVOCATION_OUTCOMES = ['revoked', 'unrevoked', 'undetermined'] as const;

const chip = extractedFieldsSchema.shape;

export const GOVERNMENT_ID_NFC_VERIFICATION_ATTRIBUTES = {
  'name-first': pii(chip['name-first'].unwrap()),
  'name-last': pii(chip['name-last'].unwrap()),
  birthdate: pii(chip.birthdate.unwrap()),
  sex: pii(chip.sex.unwrap()),
  'expiration-date': pii(chip['expiration-date'].unwrap()),
  'identification-number': pii(chip['identification-number'].unwrap()),
  nationality: pii(chip.nationality.unwrap()),
  'id-class': plain(idClassSchema),
  'issuing-country': plain(countryCodeSchema),
  'passive-authentication': plain(
    z.strictObject({
      outcome: z.enum(CHECK_STATUSES),
      integrity: z.enum(CHIP_INTEGRITY_OUTCOMES),
      'anchor-source': text(64).nullable(),
      'hash-algorithm': text(32).nullable(),
      revocation: z.enum(CHIP_REVOCATION_OUTCOMES),
    }),
  ),
  'active-authentication': plain(z.strictObject({ outcome: z.enum(CHECK_STATUSES) })),
  /**
   * C208.1, C208.4 (Phase 10, Workflow 10C): the scenario of the sandbox test chip the verification
   * was read from; left out for every other chip. The verification and the console label it
   * "Test chip (sandbox)": it proves the flow and the server's checks, never a reader.
   */
  [SANDBOX_CHIP_LABEL_MEMBER]: plain(sandboxChipScenarioSchema),
};

// Flow views (C52.2) ------------------------------------------------------------------------------

/** C52.2: the document a step accepts and the window it sends as guidance. */
export const documentGuidanceSchema = z.strictObject({
  'accepted-types': z.array(z.enum(DOCUMENT_TYPES)).min(1),
  /** `document_recency_detection`'s `max-age-days`. */
  'max-age-days': z.int().min(1).max(3650),
  'max-pages': z.int().min(1).max(50),
  'accepted-mime-types': z.array(z.enum(DOCUMENT_MIME_TYPES)).min(1),
});

/** C52.2: the open code, or `null` before the first send. Never the code itself. */
export const otpGuidanceStateSchema = z.strictObject({
  /** The destination with most characters hidden, shown so the user can spot a typo. */
  'masked-destination': text(64),
  'expires-at': timestampSchema,
  /** When the next send is allowed; `null` when no send is left. */
  'resend-available-at': timestampSchema.nullable(),
  'sends-remaining': z.int().min(0).max(OTP_MAX_SENDS),
  'attempts-remaining': z.int().min(0).max(OTP_MAX_ATTEMPTS_PER_CODE),
});

const codeLength = z.int().min(OTP_CODE_LENGTH.min).max(OTP_CODE_LENGTH.max);

export const phoneNumberGuidanceSchema = z.strictObject({
  'allowed-countries': z.array(countryCodeSchema).min(1),
  'code-length': codeLength,
  otp: otpGuidanceStateSchema.nullable(),
});

export const emailAddressGuidanceSchema = z.strictObject({
  'code-length': codeLength,
  otp: otpGuidanceStateSchema.nullable(),
});

/** The database body members (C52.3), as `fields` and `required-fields` name them. */
const databaseInputName = z.enum(Object.keys(databaseInputsSchema.shape) as [string, ...string[]]);

export const databaseGuidanceSchema = z.strictObject({
  /** The body members the step collects (C52.3 names, kebab-case). */
  fields: z.array(databaseInputName).min(1),
  'required-fields': z.array(databaseInputName),
});

export const aamvaGuidanceSchema = z.strictObject({ source: z.enum(AAMVA_SOURCES) });

export const cryptoWalletGuidanceSchema = z.strictObject({
  chains: z.array(cryptoChainIdSchema).min(1),
  signing: z.array(z.enum(CRYPTO_SIGNING_METHODS)).min(1),
});

const businessInputName = z.enum(
  Object.keys(databaseBusinessInputsSchema.shape) as [string, ...string[]],
);

export const databaseBusinessGuidanceSchema = z.strictObject({
  'collect-associated-persons': z.boolean(),
  /** Inputs every configured match group names, so the body must carry them (C52.3). */
  'required-inputs': z.array(businessInputName),
});

/** The website and NFC steps need no guidance yet. */
export const businessWebsiteGuidanceSchema = z.strictObject({});
export const governmentIdNfcGuidanceSchema = z.strictObject({});

/** Whether the form type's values were received (C52.2). */
const inputsReceived = { 'inputs-received': z.boolean().optional() };

export const FLOW_DOCUMENT_ATTRIBUTES = { guidance: documentGuidanceSchema.nullable().optional() };
export const FLOW_DATABASE_ATTRIBUTES = {
  guidance: databaseGuidanceSchema.nullable().optional(),
  ...inputsReceived,
};
export const FLOW_AAMVA_ATTRIBUTES = {
  guidance: aamvaGuidanceSchema.nullable().optional(),
  ...inputsReceived,
};
export const FLOW_PHONE_NUMBER_ATTRIBUTES = {
  guidance: phoneNumberGuidanceSchema.nullable().optional(),
};
export const FLOW_EMAIL_ADDRESS_ATTRIBUTES = {
  guidance: emailAddressGuidanceSchema.nullable().optional(),
};
export const FLOW_GOVERNMENT_ID_NFC_ATTRIBUTES = {
  guidance: governmentIdNfcGuidanceSchema.nullable().optional(),
};
export const FLOW_CRYPTO_WALLET_ATTRIBUTES = {
  guidance: cryptoWalletGuidanceSchema.nullable().optional(),
};
export const FLOW_DATABASE_BUSINESS_ATTRIBUTES = {
  guidance: databaseBusinessGuidanceSchema.nullable().optional(),
  ...inputsReceived,
};
export const FLOW_BUSINESS_WEBSITE_ATTRIBUTES = {
  guidance: businessWebsiteGuidanceSchema.nullable().optional(),
  ...inputsReceived,
};
