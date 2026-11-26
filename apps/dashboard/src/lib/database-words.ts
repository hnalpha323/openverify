/**
 * C58, C59, C66: the matching vocabulary the database results record, in words, for operators:
 * match levels, the methods a level rests on, the flags, a match group's outcome, an address's
 * components and how each compared, the database match fields, the PO box patterns, and what a
 * database pass means. The business registry shares the C58 words (`database-business-words.ts`).
 *
 * The test (`database-words.test.ts`) reads the methods, components, outcomes, flags and PO box
 * patterns from the evaluators' own source (`packages/checks`), so a value added there without
 * words here fails it. A value the console does not know is shown as its code, never as a crash.
 * Every lookup reads own entries of a `Map`, so a code such as `constructor` finds nothing.
 */
import type { MatchLevel, MatchRequirement } from '@openverify/core';
import type { DatabaseMatchField, GroupOutcome } from './database-evidence';
import type { WordsText } from './selfie-words';

export type { WordsText };

/** C66: what a database pass means, as `docs/checks/database.md` says it (its test checks every sentence against that page). */
export const DATABASE_PASS_MEANING =
  'The values the user entered match a record the bound source holds, well enough for at least one configured match group (by default name, birth date and address, each at least a partial match). A sandbox or other non-authoritative source cannot say that a person does not exist: a miss there goes to review. It does not show that the person entering the values is the person the record describes.';

const LEVELS: ReadonlyMap<string, WordsText> = new Map([
  ['full', { words: 'Full match' }],
  ['partial', { words: 'Partial match' }],
  ['none', { words: 'No match' }],
  [
    'missing',
    {
      words: 'Missing',
      explanation: 'One side has no value, or the two are in different scripts: never a mismatch.',
    },
  ],
]);

const REQUIREMENTS: ReadonlyMap<string, string> = new Map([
  ['partial', 'At least partial'],
  ['full', 'Full'],
]);

const METHODS: ReadonlyMap<string, string> = new Map([
  ['remove_prefixes', 'Prefixes removed'],
  ['remove_suffixes', 'Suffixes removed'],
  ['remove_special_characters', 'Special characters removed'],
  ['fold_characters', 'Case and accents folded'],
  ['string_similarity', 'String similarity'],
  ['string_difference', 'String difference'],
  ['nickname', 'Nickname'],
  ['substring', 'Substring'],
  ['tokenization', 'Split into words'],
  ['date_similarity', 'Date similarity'],
  ['date_difference', 'Date difference'],
]);

const AT_MOST_PARTIAL = 'so the match is at most partial.';

const FLAGS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  // Names (C58.2) and business names (C58.6).
  ['swapped', { words: 'Given and family names swapped' }],
  [
    'middle-name-mismatch',
    {
      words: 'Middle names differ',
      explanation: `Both sides carry a middle name and they differ, ${AT_MOST_PARTIAL}`,
    },
  ],
  [
    'suffix-mismatch',
    {
      words: 'Suffixes differ',
      explanation: `Both names carry a generational suffix and they differ, ${AT_MOST_PARTIAL}`,
    },
  ],
  [
    'legal-form-mismatch',
    {
      words: 'Legal forms differ',
      explanation: `Both names carry a legal form and they differ, ${AT_MOST_PARTIAL}`,
    },
  ],
  [
    'family-name-initial',
    {
      words: 'Family name given as an initial',
      explanation: 'An initial cannot confirm a family name, so the name counts as missing.',
    },
  ],
  ['family-name-missing', { words: 'Family name missing on one side' }],
  ['given-name-missing', { words: 'Given name missing on one side' }],
  [
    'name-incomplete',
    {
      words: 'Name incomplete on one side',
      explanation:
        'One side holds one word where the other holds several, so the name counts as missing.',
    },
  ],
  [
    'script-mismatch',
    {
      words: 'Different scripts',
      explanation:
        'The values are written in two scripts and cannot be compared: never a mismatch.',
    },
  ],
  // Dates (C58.5).
  [
    'precision-limited',
    {
      words: 'Less precise date',
      explanation: 'One side gives only the year and month, or only the year.',
    },
  ],
  [
    'approximate',
    { words: 'Approximate date', explanation: 'A circa or range date within a year of the other.' },
  ],
  ['transposed', { words: 'Day and month swapped' }],
  [
    'near-match',
    {
      words: 'Near match',
      explanation: 'One digit differs or two are swapped: a different date, never a match.',
    },
  ],
  [
    'century-inferred',
    { words: 'Century inferred', explanation: 'A two-digit year was read in its likely century.' },
  ],
  ['unreadable', { words: 'Date unreadable' }],
  [
    'not-accepted',
    {
      words: 'Not accepted by the template',
      explanation:
        'A precision-limited or transposed birth date the template does not accept counts as missing.',
    },
  ],
  // Addresses (C58.4).
  ['city-mismatch', { words: 'Cities differ' }],
  [
    'subdivision-mismatch',
    {
      words: 'States or regions differ',
      explanation: `The states or regions differ, ${AT_MOST_PARTIAL}`,
    },
  ],
  ['unit-one-sided', { words: 'Unit on one side only' }],
  ['house-number-one-sided', { words: 'House number on one side only' }],
  ['street-missing', { words: 'Street missing on one side' }],
  ['po-box-one-sided', { words: 'PO box on one side only' }],
  [
    'too-many-fuzzy-components',
    {
      words: 'Too many close components',
      explanation:
        'More than one component matched only closely, so the address counts as missing.',
    },
  ],
]);

const OUTCOMES: ReadonlyMap<string, WordsText> = new Map([
  ['met', { words: 'Met', explanation: 'Every field reached the level the group needs.' }],
  [
    'unmet',
    { words: 'Unmet', explanation: 'A field differs, or falls below the level the group needs.' },
  ],
  [
    'undecidable',
    {
      words: 'Undecidable',
      explanation:
        'No field falls short, but one is missing on a side, so the group cannot decide and a reviewer does.',
    },
  ],
]);

const COMPONENTS: ReadonlyMap<string, string> = new Map([
  ['country', 'Country'],
  ['postal-code', 'Postal code'],
  ['house-number', 'House number'],
  ['street', 'Street'],
  ['unit', 'Unit'],
  ['city', 'City'],
  ['subdivision', 'State or region'],
]);

const COMPONENT_MATCHES: ReadonlyMap<string, string> = new Map([
  ['exact', 'Same'],
  ['fuzzy', 'Close'],
  ['mismatch', 'Different'],
  ['one-sided', 'On one side only'],
  ['absent', 'On neither side'],
]);

const FIELDS: ReadonlyMap<string, string> = new Map([
  ['name', 'Name'],
  ['birthdate', 'Birth date'],
  ['address', 'Address'],
  ['identification-number', 'Identification number'],
  ['phone-number', 'Phone number'],
  ['email-address', 'Email address'],
]);

/** The local name of a post office box, said with what it is. */
const box = (name: string) => `${name} (post office box)`;

const PO_BOX_PATTERNS: ReadonlyMap<string, string> = new Map([
  ['po_box', 'Post office box'],
  ['box_number', 'Box number'],
  ['military', 'Military address'],
  ['private_mailbox', 'Private mailbox'],
  ['private_bag', 'Private bag'],
  ['general_delivery', 'General delivery'],
  ['apartado', box('Apartado')],
  ['casilla', box('Casilla')],
  ['postfach', box('Postfach')],
  ['boite_postale', box('Boîte postale')],
  ['caixa_postal', box('Caixa postal')],
  ['casella_postale', box('Casella postale')],
  ['postbus', box('Postbus')],
  ['postboks', box('Postboks')],
  ['postilokero', box('Postilokero')],
  ['skrytka_pocztowa', box('Skrytka pocztowa')],
  ['posta_kutusu', box('Posta kutusu')],
]);

/** The words of an attribute name that are acronyms. */
const ACRONYMS: ReadonlyMap<string, string> = new Map([
  ['id', 'ID'],
  ['lei', 'LEI'],
  ['url', 'URL'],
  ['aamva', 'AAMVA'],
]);

/** A match level (C58.1) in words; a recorded level, already validated, always has some. */
export function matchLevelText(level: MatchLevel): WordsText;
export function matchLevelText(level: string): WordsText | undefined;
export function matchLevelText(level: string): WordsText | undefined {
  return LEVELS.get(level);
}

/** The level a match group needs a field to reach (`partial` is also met by `full`). */
export function matchRequirementText(requirement: MatchRequirement): string;
export function matchRequirementText(requirement: string): string | undefined;
export function matchRequirementText(requirement: string): string | undefined {
  return REQUIREMENTS.get(requirement);
}

/** A public comparison method id (C58.1) in words. */
export function matchMethodText(method: string): string | undefined {
  return METHODS.get(method);
}

/** A match flag (C58, kebab-case, never a value) in words. */
export function matchFlagText(flag: string): WordsText | undefined {
  return FLAGS.get(flag);
}

/** A match group's outcome (C58.1) in words. */
export function groupOutcomeText(outcome: GroupOutcome): WordsText;
export function groupOutcomeText(outcome: string): WordsText | undefined;
export function groupOutcomeText(outcome: string): WordsText | undefined {
  return OUTCOMES.get(outcome);
}

/** An address component (C58.4) in words. */
export function addressComponentText(component: string): string | undefined {
  return COMPONENTS.get(component);
}

/** How one address component compared (C58.4) in words. */
export function componentMatchText(match: string): string | undefined {
  return COMPONENT_MATCHES.get(match);
}

/** A database match field (C51.3) in words. */
export function databaseFieldText(field: DatabaseMatchField): string;
export function databaseFieldText(field: string): string | undefined;
export function databaseFieldText(field: string): string | undefined {
  return FIELDS.get(field);
}

/** A PO box pattern id (`database_po_box_detection`'s `matched-patterns`) in words. */
export function poBoxPatternText(pattern: string): string | undefined {
  return PO_BOX_PATTERNS.get(pattern);
}

/**
 * An attribute's API member name as the evidence terms it, as the generic view did:
 * `name-first` is "Name first", `registry-record-id` "Registry record ID".
 */
export function attributeTerm(name: string): string {
  const [first = '', ...rest] = name.split('-').map((word) => ACRONYMS.get(word) ?? word);
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** Whether the source is authoritative, and what a miss from it means for the identity. */
export function databaseAuthorityText(authoritative: boolean): WordsText {
  return authoritative
    ? { words: 'Yes', explanation: 'A miss from this source fails the identity check.' }
    : { words: 'No', explanation: 'A miss from this source goes to review, never to a failure.' };
}

/** Whether a check is required or advisory, as the evidence says it. */
export function requirementText(required: boolean): string {
  return required ? 'Required' : 'Advisory';
}
