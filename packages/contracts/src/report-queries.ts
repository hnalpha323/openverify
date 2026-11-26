/**
 * Report query bodies (plan C79-C82, C84.2): what `POST /reports` takes under
 * `data.attributes.query`, per type, in the public request shapes (H22), and the `query` a report
 * serves back, member by member nullable so a masked or redacted query still parses.
 *
 * The bodies are validated here at the edge; a completion report (C84.2) is created even when its
 * query lacks a required input, so the served schemas require nothing and their run ends
 * `errored` with `insufficient_input`. No schema transforms anything (the OpenAPI document is
 * generated from them).
 */
import { LIST_LIMITS, cryptoChainIdSchema, idClassSchema, type ReportType } from '@openverify/core';
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';

/** The caps of the query members (C79-C82). */
export const REPORT_QUERY_LIMITS = Object.freeze({
  /** A name part or term (C79.1). */
  name: 300,
  /** `additional-names`, ours (C84.2). */
  additionalNames: 3,
  /** An identification or registration number. */
  identifier: 100,
  /** As OFAC allows (C79.3). */
  cryptoAddress: 256,
  emailAddress: 254,
  addressee: 200,
  street: 200,
  city: 100,
  subdivision: 100,
  postalCode: 20,
  website: 500,
});

/** C79.1: the identification kinds a person query may carry. */
export const IDENTIFICATION_TYPES = ['passport', 'national_id', 'tax_id'] as const;

/**
 * C84.2: where a query field came from: the request, or, for a completion report, the
 * verified data first (H04).
 */
export const REPORT_QUERY_SOURCES = [
  'request',
  'government_id',
  'inquiry_fields',
  'account_fields',
  'otp_confirmed',
  'crypto_wallet',
  'business_registry',
  'business_entered',
  // C106.1 (Phase 7): the first evaluated session's address at completion.
  'inquiry_session',
  // C106.2 (Workflow 7B): the issuing country of the government ID (C99.5).
  'government_id_country',
] as const;
export const reportQuerySourceSchema = z.enum(REPORT_QUERY_SOURCES);

/** A person's name part: a letter at least, at most 300 characters, no control characters. */
const personName = z
  .string()
  .min(1)
  .max(REPORT_QUERY_LIMITS.name)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters')
  .regex(/\p{L}/u, 'must contain a letter');

/** A business name: a letter or a digit at least. */
const businessName = z
  .string()
  .min(1)
  .max(REPORT_QUERY_LIMITS.name)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters')
  .regex(/[\p{L}\p{N}]/u, 'must contain a letter or a digit');

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^\P{Cc}+$/u, 'must not contain control characters')
    .regex(/\S/u, 'must not be blank');

/** C58.5: a year, a year and month, or a full date, as a partial birthdate. */
const partialDate = z
  .string()
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^[0-9]{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12][0-9]|3[01]))?)?$/,
    'must be YYYY, YYYY-MM or YYYY-MM-DD',
  )
  .refine((value) => {
    if (value.length < 10) {
      return true;
    }
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'must be a calendar date');

const NAME_PARTS = {
  'name-first': personName.optional(),
  'name-middle': personName.optional(),
  'name-last': personName.optional(),
  term: personName.optional(),
};

interface NameParts {
  readonly 'name-first'?: string | undefined;
  readonly 'name-last'?: string | undefined;
  readonly term?: string | undefined;
}

/** The public rule: a first name, a last name or a term (a middle name alone is not enough). */
const hasName = (value: NameParts) =>
  value['name-first'] !== undefined || value['name-last'] !== undefined || value.term !== undefined;

const NAME_REQUIRED = 'needs name-first, name-last or term';

function requireName(value: NameParts, ctx: z.RefinementCtx): void {
  if (!hasName(value)) {
    ctx.addIssue({ code: 'custom', message: NAME_REQUIRED, path: ['term'] });
  }
}

/** C84.2 (ours): another name of the same person, screened too. */
const additionalNameSchema = z.strictObject(NAME_PARTS).superRefine(requireName);
const additionalNames = z
  .array(additionalNameSchema)
  .min(1)
  .max(REPORT_QUERY_LIMITS.additionalNames);

const WATCHLIST_SHAPE = {
  ...NAME_PARTS,
  birthdate: partialDate.optional(),
  'address-country-code': countryCodeSchema.optional(),
  gender: z.enum(['female', 'male']).optional(),
  'identification-number': text(REPORT_QUERY_LIMITS.identifier).optional(),
  'identification-type': z.enum(IDENTIFICATION_TYPES).optional(),
  'identification-country-code': countryCodeSchema.optional(),
  'additional-names': additionalNames.optional(),
};

/** C79.1: the person watchlist query, the public request plus `additional-names`. */
export const watchlistQuerySchema = z.strictObject(WATCHLIST_SHAPE).superRefine((query, ctx) => {
  requireName(query, ctx);
  if (
    (query['identification-number'] === undefined) !==
    (query['identification-type'] === undefined)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'identification-number and identification-type go together',
      path: [
        query['identification-type'] === undefined
          ? 'identification-type'
          : 'identification-number',
      ],
    });
  }
});

const BUSINESS_WATCHLIST_SHAPE = {
  term: businessName,
  'address-country-code': countryCodeSchema.optional(),
  'registration-number': text(REPORT_QUERY_LIMITS.identifier).optional(),
  /** ISO 17442: 18 characters and two check digits; the check is the matcher's (C79.2). */
  lei: z
    .string()
    .regex(/^[A-Z0-9]{18}[0-9]{2}$/, 'must be a 20-character LEI')
    .optional(),
  website: z
    .string()
    .min(1)
    .max(REPORT_QUERY_LIMITS.website)
    .regex(/^\S+$/u, 'must not contain spaces')
    // eslint-disable-next-line security/detect-unsafe-regex -- anchored at the start and open at the end: the first dot with a character after it ends the match; at most 500 characters
    .regex(/^(?:https?:\/\/)?[a-z0-9][^\s/?#]*\.[^\s/?#]+/iu, 'must be a domain or an http(s) URL')
    .optional(),
  'swift-bic': z
    .string()
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/, 'must be an 8- or 11-character BIC')
    .optional(),
  /** Seven digits; the check digit is the matcher's (C79.2). */
  'imo-number': z
    .string()
    .regex(/^[0-9]{7}$/, 'must be a 7-digit IMO number')
    .optional(),
  mmsi: z
    .string()
    .regex(/^[0-9]{9}$/, 'must be a 9-digit MMSI')
    .optional(),
  'aircraft-serial': text(50).optional(),
  'aircraft-tail': z
    .string()
    .regex(/^[A-Za-z0-9-]{1,20}$/, 'must be letters, digits and hyphens')
    .optional(),
};

/** C79.2: the business watchlist query, the public request plus exact identifiers. */
export const businessWatchlistQuerySchema = z.strictObject(BUSINESS_WATCHLIST_SHAPE);

const CRYPTO_SHAPE = {
  /** Trimmed and stripped of a URI scheme by the matcher, then canonicalised (C79.3). */
  'crypto-address': text(REPORT_QUERY_LIMITS.cryptoAddress),
  'chain-id': cryptoChainIdSchema.optional(),
};

/** C79.3: the crypto address query. */
export const cryptoAddressWatchlistQuerySchema = z.strictObject(CRYPTO_SHAPE);

const PERSON_SCREENING_SHAPE = {
  ...NAME_PARTS,
  birthdate: partialDate.optional(),
  'country-code': countryCodeSchema.optional(),
  'additional-names': additionalNames.optional(),
};

/** C80.5: the public PEP request plus `additional-names`. */
export const politicallyExposedPersonQuerySchema = z
  .strictObject(PERSON_SCREENING_SHAPE)
  .superRefine(requireName);

/** C81.5: the public person adverse-media request plus `additional-names`. */
export const adverseMediaQuerySchema = z
  .strictObject(PERSON_SCREENING_SHAPE)
  .superRefine(requireName);

const BUSINESS_MEDIA_SHAPE = {
  term: businessName,
  'country-code': countryCodeSchema.optional(),
};

/** C81.5: the business adverse-media request. */
export const businessAdverseMediaQuerySchema = z.strictObject(BUSINESS_MEDIA_SHAPE);

const EMAIL_SHAPE = {
  'email-address': z
    .string()
    .min(3)
    .max(REPORT_QUERY_LIMITS.emailAddress)
    .regex(/^[^\s@]+@[^\s@]+$/u, 'must be an email address'),
};

/** C82.1: the email address query. */
export const emailAddressQuerySchema = z.strictObject(EMAIL_SHAPE);

const PHONE_SHAPE = {
  'phone-number': z.string().regex(/^\+[1-9][0-9]{1,14}$/, 'must be an E.164 number'),
};

/** C82.2: the phone number query, in E.164. */
export const phoneNumberQuerySchema = z.strictObject(PHONE_SHAPE);

const ADDRESS_SHAPE = {
  addressee: text(REPORT_QUERY_LIMITS.addressee).optional(),
  'address-street-1': text(REPORT_QUERY_LIMITS.street),
  'address-street-2': text(REPORT_QUERY_LIMITS.street).optional(),
  'address-city': text(REPORT_QUERY_LIMITS.city),
  'address-subdivision': text(REPORT_QUERY_LIMITS.subdivision),
  'address-postal-code': text(REPORT_QUERY_LIMITS.postalCode),
  'address-country-code': countryCodeSchema,
};

/** C82.3: the public address lookup request. */
export const addressLookupQuerySchema = z.strictObject(ADDRESS_SHAPE);

/**
 * C106.1: one IPv4 or IPv6 host. CIDR ranges, netmasks and zone indexes are refused: the report
 * answers for one address, as the session's network facts do.
 */
const IP_ADDRESS_SHAPE = {
  'ip-address': z.union([z.ipv4(), z.ipv6()], {
    error: 'must be one IPv4 or IPv6 address, without a range, netmask or zone',
  }),
};

/** C106.1: the public ip-address request. */
export const ipAddressQuerySchema = z.strictObject(IP_ADDRESS_SHAPE);

/** C106.2: `government-id-number`'s cap, and how many lists one report may select. */
const CUSTOM_LIST_SHAPE = {
  'name-first': personName.optional(),
  'name-last': personName.optional(),
  'email-address': EMAIL_SHAPE['email-address'].optional(),
  'phone-number': PHONE_SHAPE['phone-number'].optional(),
  'government-id-number': text(REPORT_QUERY_LIMITS.identifier).optional(),
  'government-id-class': idClassSchema.optional(),
  'ip-address': IP_ADDRESS_SHAPE['ip-address'].optional(),
  'country-code': countryCodeSchema.optional(),
  string: text(LIST_LIMITS.stringValueLength).optional(),
  /** 1-20, or pinned on the report template. */
  'list-ids': z
    .array(idSchema('lst'))
    .min(1)
    .max(LIST_LIMITS.reportLists)
    .refine((ids) => new Set(ids).size === ids.length, 'must not contain duplicates')
    .optional(),
};

/** The members a custom-list query can screen. */
const CUSTOM_LIST_VALUES = [
  'name-first',
  'name-last',
  'email-address',
  'phone-number',
  'government-id-number',
  'ip-address',
  'country-code',
  'string',
] as const;

/** C106.2: any of the values, plus `list-ids`; the class qualifies a number and nothing else. */
export const customListQuerySchema = z.strictObject(CUSTOM_LIST_SHAPE).superRefine((query, ctx) => {
  if (!CUSTOM_LIST_VALUES.some((member) => query[member] !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'needs a value to screen', path: ['string'] });
  }
  if (query['government-id-class'] !== undefined && query['government-id-number'] === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'government-id-class qualifies a government-id-number',
      path: ['government-id-class'],
    });
  }
});

/** C79-C82: the query body of each type. */
export const REPORT_QUERY_SCHEMAS = Object.freeze({
  watchlist: watchlistQuerySchema,
  'business-watchlist': businessWatchlistQuerySchema,
  'crypto-address-watchlist': cryptoAddressWatchlistQuerySchema,
  'politically-exposed-person': politicallyExposedPersonQuerySchema,
  'adverse-media': adverseMediaQuerySchema,
  'business-adverse-media': businessAdverseMediaQuerySchema,
  'email-address': emailAddressQuerySchema,
  'phone-number': phoneNumberQuerySchema,
  'address-lookup': addressLookupQuerySchema,
  'ip-address': ipAddressQuerySchema,
  'custom-list': customListQuerySchema,
} as const satisfies Record<ReportType, z.ZodType>);

const SHAPES = {
  watchlist: WATCHLIST_SHAPE,
  'business-watchlist': BUSINESS_WATCHLIST_SHAPE,
  'crypto-address-watchlist': CRYPTO_SHAPE,
  'politically-exposed-person': PERSON_SCREENING_SHAPE,
  'adverse-media': PERSON_SCREENING_SHAPE,
  'business-adverse-media': BUSINESS_MEDIA_SHAPE,
  'email-address': EMAIL_SHAPE,
  'phone-number': PHONE_SHAPE,
  'address-lookup': ADDRESS_SHAPE,
  'ip-address': IP_ADDRESS_SHAPE,
  'custom-list': CUSTOM_LIST_SHAPE,
} as const satisfies Record<ReportType, z.ZodRawShape>;

/** A served query: every member optional and nullable, nothing required (C70.2, C84.2). */
function servedQuerySchema(shape: z.ZodRawShape) {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(shape).map(([name, member]) => {
        const inner =
          member instanceof z.ZodOptional ? (member.unwrap() as z.ZodType) : (member as z.ZodType);
        return [name, inner.nullable().optional()];
      }),
    ),
  );
}

/** C70.2: the `query` attribute each type serves, masked member-wise (C70.3). */
export const SERVED_REPORT_QUERY_SCHEMAS = Object.freeze({
  watchlist: servedQuerySchema(WATCHLIST_SHAPE),
  'business-watchlist': servedQuerySchema(BUSINESS_WATCHLIST_SHAPE),
  'crypto-address-watchlist': servedQuerySchema(CRYPTO_SHAPE),
  'politically-exposed-person': servedQuerySchema(PERSON_SCREENING_SHAPE),
  'adverse-media': servedQuerySchema(PERSON_SCREENING_SHAPE),
  'business-adverse-media': servedQuerySchema(BUSINESS_MEDIA_SHAPE),
  'email-address': servedQuerySchema(EMAIL_SHAPE),
  'phone-number': servedQuerySchema(PHONE_SHAPE),
  'address-lookup': servedQuerySchema(ADDRESS_SHAPE),
  'ip-address': servedQuerySchema(IP_ADDRESS_SHAPE),
  'custom-list': servedQuerySchema(CUSTOM_LIST_SHAPE),
} as const satisfies Record<ReportType, z.ZodType>);

/** The query members of each type, in their schema's order. */
export const REPORT_QUERY_FIELDS: Readonly<Record<ReportType, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SHAPES).map(([type, shape]) => [type, Object.freeze(Object.keys(shape))]),
  ) as Record<ReportType, readonly string[]>,
);
