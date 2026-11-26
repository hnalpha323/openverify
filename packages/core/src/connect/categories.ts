/**
 * C230.4 (Phase 11, Workflow 11A Stage 1a; review F07): the data classes, the share categories and
 * the class of every field type, as code. Frozen: `connect-logic` computes a share's categories
 * from this table, a consent covers a share only if its categories include every category the share
 * carries (C232.1), and Phase 11's data classification (C276.2) is generated from it, never the
 * other way round.
 *
 * Ours: the public API has no data categories. They exist because a consent must name what is
 * disclosed (C236.1).
 */
import { FIELD_SCHEMA_TYPES, type FieldSchemaType } from '../transactions/field-types.js';

/** C276.2: the classes of data the platform holds. A share carries only the first four. */
export const DATA_CLASSES = Object.freeze([
  'biometric',
  'identity-documents',
  'identity-fields',
  'contact',
  'device-and-network',
  'financial-and-crypto',
  'operator-and-audit',
  'secrets',
  'public-and-list-data',
] as const);
export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * C230.4: the closed set a share token and a consent record carry. `biometric` covers selfie
 * images, ID portraits, and liveness and face-match results; a face template is in no category,
 * because it is never shared (decision 23).
 */
export const SHARE_CATEGORIES = Object.freeze([
  'identity-fields',
  'contact-fields',
  'other-fields',
  'document-images',
  'biometric',
  'check-results',
] as const);
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

/** The data class of each share category (C276.2's "share category" column, read the other way). */
export const SHARE_CATEGORY_DATA_CLASS: Readonly<Record<ShareCategory, DataClass>> = Object.freeze({
  'identity-fields': 'identity-fields',
  'contact-fields': 'contact',
  // A field of a type that names no kind of personal data is still the subject's field.
  'other-fields': 'identity-fields',
  'document-images': 'identity-documents',
  biometric: 'biometric',
  // A check result is derived from the evidence it judged.
  'check-results': 'identity-documents',
});

/** The three categories a field can fall in, and `document-images` for a field that holds a file. */
export type FieldShareCategory = Extract<
  ShareCategory,
  'identity-fields' | 'contact-fields' | 'other-fields' | 'document-images'
>;

/** Every field type of a template, an account type or a transaction type (the fifteen wire types). */
export const SHARE_FIELD_TYPES = FIELD_SCHEMA_TYPES;
export type ShareFieldType = FieldSchemaType;

/**
 * C230.4: the category of a field, by its type. No field type says "a name", "an address" or "a
 * phone number", so a free-form type (`string`, `array`, `hash`, `json`) is classed as identity:
 * it may hold any of them, and the class that needs the more specific consent wins.
 * {@link WELL_KNOWN_FIELD_CATEGORY} names the keys whose meaning is known whatever their type.
 */
export const FIELD_TYPE_CLASS: Readonly<Record<ShareFieldType, FieldShareCategory>> = Object.freeze(
  {
    string: 'identity-fields',
    integer: 'other-fields',
    number: 'other-fields',
    boolean: 'other-fields',
    datetime: 'identity-fields',
    'email-address': 'contact-fields',
    date: 'identity-fields',
    choices: 'other-fields',
    'multi-choices': 'other-fields',
    array: 'identity-fields',
    hash: 'identity-fields',
    file: 'document-images',
    'platform-file': 'document-images',
    json: 'identity-fields',
    // A relation names another object; no hydrate copies one (K7C-2), so it never joins a share.
    'relation-schema': 'other-fields',
  },
);

/**
 * C230.4: the extracted-data keys (`packages/core/src/extraction.ts`) and the contact keys, whose
 * category is fixed whatever type a template declares them with: a `phone-number` field is contact
 * data even though its type is `string`.
 */
export const WELL_KNOWN_FIELD_CATEGORY: Readonly<Record<string, FieldShareCategory>> =
  Object.freeze({
    'name-first': 'identity-fields',
    'name-middle': 'identity-fields',
    'name-last': 'identity-fields',
    birthdate: 'identity-fields',
    'identification-number': 'identity-fields',
    'address-street-1': 'identity-fields',
    'address-street-2': 'identity-fields',
    'address-city': 'identity-fields',
    'address-subdivision': 'identity-fields',
    'address-postal-code': 'identity-fields',
    'address-country-code': 'identity-fields',
    'phone-number': 'contact-fields',
    'email-address': 'contact-fields',
  });

/**
 * The category of a field: its well-known key's, else its type's. An inquiry spells its keys in
 * snake_case (`name_first`) and a verification in kebab-case (`name-first`), so the key is read in
 * kebab-case.
 */
export function fieldShareCategory(key: string, type: ShareFieldType): FieldShareCategory {
  const known = key.replaceAll('_', '-');
  return Object.hasOwn(WELL_KNOWN_FIELD_CATEGORY, known)
    ? (WELL_KNOWN_FIELD_CATEGORY[known] ?? FIELD_TYPE_CLASS[type])
    : FIELD_TYPE_CLASS[type];
}
