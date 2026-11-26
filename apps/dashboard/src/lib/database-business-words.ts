/**
 * C61.1, C61.2, C61.7, C66: the business registry vocabulary in words, for operators: the
 * registers, the business match fields, how the register's status was read and its flags, what the
 * register's authority means, and what a business registry pass means. The match levels, methods,
 * flags and group outcomes are the database's (`database-words.ts`, C58).
 *
 * The test (`database-business-words.test.ts`) reads the registers from the contracts and the
 * status answers and flags from the evaluators' own source. Every lookup reads own entries of a
 * `Map`.
 */
import type { BUSINESS_REGISTRY_SOURCES } from '@openverify/contracts';
import type { BusinessMatchField, StatusReading } from './database-business-evidence';
import type { WordsText } from './selfie-words';

/** C66: what a business registry pass means, as `docs/checks/business.md` says it (its test checks every sentence against that page). */
export const DATABASE_BUSINESS_PASS_MEANING =
  "A public register holds an active business whose name matches the one entered, together with its registration number, or with its address (by default). It does not mean the user acts for that business: unless the step collects associated persons and they match, anyone who knows a company's public details can enter them. A register that does not list a business (a sole trader, a partnership, a small company GLEIF never saw) gives no failure: the verification goes to review.";

/** Who a register lists as associated persons, and why one may be missing (C61.7). */
export const ASSOCIATED_PERSONS_NOTE =
  'A register lists a company’s officers and its persons with significant control (individuals holding more than 25% of the shares or votes, or otherwise in control); a shareholder below that threshold who is not an officer is not listed.';

const SOURCES: ReadonlyMap<string, string> = new Map([
  ['gleif', 'GLEIF'],
  ['companies-house', 'Companies House'],
  ['sec-edgar', 'SEC EDGAR'],
  ['sandbox', 'Sandbox register'],
]);

const FIELDS: ReadonlyMap<string, string> = new Map([
  ['name', 'Business name'],
  ['registration-number', 'Registration number'],
  ['address', 'Registered address'],
]);

const READINGS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  ['active', { words: 'Active' }],
  [
    'inactive',
    {
      words: 'Inactive',
      explanation: 'Dissolved, closed, in liquidation or otherwise no longer trading.',
    },
  ],
  [
    'not-available',
    {
      words: 'Not available',
      explanation: 'The register gave no status this check can map, so a reviewer decides.',
    },
  ],
  [
    'no-record',
    {
      words: 'No usable record',
      explanation: 'No register holds the business, or its LEI was annulled or is a duplicate.',
    },
  ],
]);

const FLAGS: ReadonlyMap<string, WordsText> = new Map([
  [
    'lei-lapsed',
    {
      words: 'LEI lapsed',
      explanation:
        'Often an unpaid renewal of a live business, so it goes to review unless the template fails it.',
    },
  ],
  [
    'active-proposal-to-strike-off',
    {
      words: 'Active proposal to strike off',
      explanation: 'Companies House lists a proposal to remove the company from the register.',
    },
  ],
  [
    'status-unmapped',
    {
      words: 'Status not mapped',
      explanation:
        'The register’s value is not in the status table, so it is never read as active.',
    },
  ],
  [
    'country-not-covered',
    {
      words: 'Country not covered',
      explanation: 'None of the registers bound in this environment covers the business’s country.',
    },
  ],
]);

/** A register (`registry-source`, C61.1) by name. */
export function registrySourceText(source: (typeof BUSINESS_REGISTRY_SOURCES)[number]): string;
export function registrySourceText(source: string): string | undefined;
export function registrySourceText(source: string): string | undefined {
  return SOURCES.get(source);
}

/** A business match field (C51.3) in words. */
export function businessFieldText(field: BusinessMatchField): string;
export function businessFieldText(field: string): string | undefined;
export function businessFieldText(field: string): string | undefined {
  return FIELDS.get(field);
}

/** How the register's status was read (`StatusReading`) in words. */
export function statusReadingText(reading: StatusReading): WordsText;
export function statusReadingText(reading: string): WordsText | undefined;
export function statusReadingText(reading: string): WordsText | undefined {
  return READINGS.get(reading);
}

/** A status or coverage flag of the registry checks in words. */
export function registryFlagText(flag: string): WordsText | undefined {
  return FLAGS.get(flag);
}

/**
 * Whether the register is authoritative, and what a miss from it means: an authoritative
 * register's miss on an entered number goes to review as a number not on the register (V14), and
 * any other miss as a business no register holds; neither is fraud.
 */
export function businessAuthorityText(authoritative: boolean): WordsText {
  return authoritative
    ? {
        words: 'Yes',
        explanation:
          'A number it lacks is reported as not on the register and goes to review, not to a failure.',
      }
    : { words: 'No', explanation: 'A miss from this register goes to review, never to a failure.' };
}
