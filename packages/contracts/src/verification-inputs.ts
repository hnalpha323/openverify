/**
 * C52.3: the values a user enters for the form types (database, the AAMVA form, the business
 * registry and the business website), sent to `POST /api/v1/flow/verifications/:id/inputs`.
 * Bodies are kebab-case and strict; the server strips C0 controls and bidirectional overrides
 * ({@link sanitizeInputValue}), seals the values (C53) and never echoes them. Which members a
 * body may and must carry also depends on the step and the template (the step's `fields` and
 * `requiredFields`, the business match groups' `required-inputs`), which the inputs service
 * checks, answering 422 with JSON Pointers.
 */
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';

/** The most associated persons a business body may name (C52.3). */
export const MAX_ASSOCIATED_PERSONS = 10;

/** US states, the District of Columbia and the territories: the AAMVA issuing authorities. */
export const US_JURISDICTIONS = Object.freeze([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'AS',
  'GU',
  'MP',
  'PR',
  'VI',
] as const);

const CONTROL_AND_BIDI = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** C52.3: an entered value as the server keeps it: control and bidirectional characters removed. */
export function sanitizeInputValue(value: string): string {
  return value.replace(CONTROL_AND_BIDI, '');
}

const name = z.string().min(1).max(200);
const isoDate = z.iso.date();
/** E.164: a plus, then up to 15 digits with no leading zero. */
const e164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'must be an E.164 phone number');
const street = z.string().min(1).max(200);
const city = z.string().min(1).max(100);
const subdivision = z.string().min(1).max(100);
const postalCode = z.string().min(1).max(20);
const identificationNumber = z.string().min(1).max(64);

/** C52.3: a database step's values, each optional here; the step decides which it takes. */
export const databaseInputsSchema = z.strictObject({
  'name-first': name.optional(),
  'name-middle': name.optional(),
  'name-last': name.optional(),
  birthdate: isoDate.optional(),
  'address-street-1': street.optional(),
  'address-street-2': street.optional(),
  'address-city': city.optional(),
  'address-subdivision': subdivision.optional(),
  'address-postal-code': postalCode.optional(),
  'address-country-code': countryCodeSchema.optional(),
  'identification-number': identificationNumber.optional(),
  'phone-number': e164.optional(),
  'email-address': z.email().max(254).optional(),
});
export type DatabaseInputs = z.infer<typeof databaseInputsSchema>;

/** C52.3: the AAMVA form, a US driver licence or ID card as printed. */
export const aamvaInputsSchema = z.strictObject({
  'name-first': name,
  'name-last': name,
  birthdate: isoDate,
  'identification-number': identificationNumber,
  'issuing-authority': z.enum(US_JURISDICTIONS),
  'issue-date': isoDate.optional(),
  'expiration-date': isoDate.optional(),
  'address-postal-code': z
    .string()
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^[0-9]{5}(?:-[0-9]{4})?$/, 'must be a US ZIP code')
    .optional(),
});
export type AamvaInputs = z.infer<typeof aamvaInputsSchema>;

/**
 * C52.3: a registration number in the format of the registry that covers `country`: Companies
 * House for GB, a numeric CIK for SEC EDGAR (US), otherwise up to 20 letters and digits.
 */
export function registrationNumberAccepted(country: string, number: string): boolean {
  if (country === 'GB') {
    return /^(?:[0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(number);
  }
  if (country === 'US') {
    return /^[0-9]{1,10}$/.test(number);
  }
  return /^[A-Za-z0-9]{1,20}$/.test(number);
}

/** ISO 17442: 18 upper-case letters and digits, then two check digits by ISO 7064 MOD 97-10. */
export function isLei(value: string): boolean {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(value)) {
    return false;
  }
  let remainder = 0;
  for (const character of value) {
    for (const digit of String(Number.parseInt(character, 36))) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** A person's birth month (`YYYY-MM`) or full date. */
const birthMonthOrDate = z.union([
  isoDate,
  z.string().regex(/^[0-9]{4}-(?:0[1-9]|1[0-2])$/, 'must be YYYY-MM or YYYY-MM-DD'),
]);

/** C52.3: an associated person, refused unless the step collects them. */
export const associatedPersonInputSchema = z.strictObject({
  'name-first': name,
  'name-last': name,
  birthdate: birthMonthOrDate.optional(),
});

/** C52.3: a business to look up in business registries. */
export const databaseBusinessInputsSchema = z
  .strictObject({
    'business-name': z.string().min(1).max(300),
    'country-code': countryCodeSchema,
    'registration-number': z.string().min(1).max(20).optional(),
    lei: z.string().length(20).optional(),
    'address-street-1': street.optional(),
    'address-street-2': street.optional(),
    'address-city': city.optional(),
    'address-subdivision': subdivision.optional(),
    'address-postal-code': postalCode.optional(),
    'associated-persons': z
      .array(associatedPersonInputSchema)
      .max(MAX_ASSOCIATED_PERSONS)
      .optional(),
  })
  .superRefine((body, ctx) => {
    const number = body['registration-number'];
    if (number !== undefined && !registrationNumberAccepted(body['country-code'], number)) {
      ctx.addIssue({
        code: 'custom',
        message: 'is not a registration number of the registry for this country',
        path: ['registration-number'],
      });
    }
    if (body.lei !== undefined && !isLei(body.lei)) {
      ctx.addIssue({ code: 'custom', message: 'is not a valid LEI (ISO 17442)', path: ['lei'] });
    }
  });
export type DatabaseBusinessInputs = z.infer<typeof databaseBusinessInputsSchema>;

/** The longest website URL taken (C52.3). */
export const MAX_WEBSITE_URL_LENGTH = 2048;

/**
 * C52.3: an `http` or `https` URL of a named host (with a dot, no IP literal), without
 * credentials, on the default port of its scheme or the other web port (80 or 443), at most
 * {@link MAX_WEBSITE_URL_LENGTH} characters. The site itself is never fetched (C61.3).
 */
export function isAcceptableWebsiteUrl(value: string): boolean {
  if (value.length > MAX_WEBSITE_URL_LENGTH || !URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  const host = url.hostname;
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    ['', '80', '443'].includes(url.port) &&
    host.includes('.') &&
    !host.startsWith('.') &&
    !host.endsWith('.') &&
    !host.startsWith('[') &&
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    !/^[0-9]+(?:\.[0-9]+){3}$/.test(host)
  );
}

/** C52.3: a business website, by its URL. */
export const businessWebsiteInputsSchema = z.strictObject({
  'website-url': z
    .string()
    .max(MAX_WEBSITE_URL_LENGTH)
    .refine(
      isAcceptableWebsiteUrl,
      'must be an http or https URL of a named host on port 80 or 443',
    ),
  'business-name': z.string().min(1).max(300).optional(),
});
export type BusinessWebsiteInputs = z.infer<typeof businessWebsiteInputsSchema>;

/** C52.3: each form type's body, by API verification type. */
export const INPUTS_SCHEMA_BY_API_TYPE = Object.freeze({
  database: databaseInputsSchema,
  aamva: aamvaInputsSchema,
  'database-business': databaseBusinessInputsSchema,
  'business-website': businessWebsiteInputsSchema,
});

/** The API types whose flow takes entered values (C52.3). */
export const INPUT_API_VERIFICATION_TYPES = Object.freeze(
  Object.keys(INPUTS_SCHEMA_BY_API_TYPE) as (keyof typeof INPUTS_SCHEMA_BY_API_TYPE)[],
);

/**
 * `POST /api/v1/flow/verifications/:id/inputs` body: any of the four. The service validates it
 * again with its type's schema, so its 422 points at the members its type refuses.
 */
export const flowInputsBodySchema = z.union([
  databaseInputsSchema,
  aamvaInputsSchema,
  databaseBusinessInputsSchema,
  businessWebsiteInputsSchema,
]);
export type FlowInputsBody = z.infer<typeof flowInputsBodySchema>;
