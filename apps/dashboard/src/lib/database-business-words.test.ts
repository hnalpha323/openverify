// @vitest-environment node
/**
 * C61.1, C61.2, C61.7, C66: the business registry vocabulary in words. The registers come from
 * the contracts, the match fields from core, and the status answers and flags from the
 * evaluators' own source (`packages/checks/src/business`), so one added there without words here
 * fails this test.
 */
import { readFileSync } from 'node:fs';
import { BUSINESS_REGISTRY_SOURCES } from '@openverify/contracts';
import { BUSINESS_MATCH_FIELDS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import type { StatusReading } from './database-business-evidence';
import {
  ASSOCIATED_PERSONS_NOTE,
  DATABASE_BUSINESS_PASS_MEANING,
  businessAuthorityText,
  businessFieldText,
  registryFlagText,
  registrySourceText,
  statusReadingText,
} from './database-business-words';

const source = (file: string) =>
  readFileSync(
    new URL(`../../../../packages/checks/src/business/${file}`, import.meta.url),
    'utf8',
  );

const literals = (text: string) =>
  [...text.matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);

/** The status flags `status.ts` documents and writes, and the service check's coverage flag. */
const STATUS_SOURCE = source('status.ts');
const FLAGS = [
  ...new Set([
    ...literals(/Kebab-case flags: ([^\n]*)/.exec(STATUS_SOURCE)?.[1]?.replaceAll('`', "'") ?? ''),
    ...literals(
      /flags: \[([^\]]*)\]/.exec(source('database-business-service-available-detection.ts'))?.[1] ??
        '',
    ),
  ]),
];

/** `BusinessStatusAnswer` as the evaluator types it, and the console's readings of it. */
const ANSWERS = literals(/type BusinessStatusAnswer =([^;]*);/.exec(STATUS_SOURCE)?.[1] ?? '');
const READINGS: Readonly<Record<string, StatusReading>> = {
  active: 'active',
  inactive: 'inactive',
  not_available: 'not-available',
  no_record: 'no-record',
};

const WORDS = /^[A-Z][^_]{1,79}$/;
const SENTENCE = /^[A-Z][^_]+\.$/;

describe('the business registry vocabulary in words (C61, C66)', () => {
  it.each(BUSINESS_REGISTRY_SOURCES)('names the register %s', (register) => {
    expect(registrySourceText(register)).toMatch(WORDS);
  });

  it('names the registers as their publishers do, and the sandbox as a sandbox', () => {
    expect(BUSINESS_REGISTRY_SOURCES.map((register) => registrySourceText(register))).toEqual([
      'GLEIF',
      'Companies House',
      'SEC EDGAR',
      'Sandbox register',
    ]);
  });

  it.each(BUSINESS_MATCH_FIELDS)('names the match field %s', (field) => {
    expect(businessFieldText(field)).toMatch(WORDS);
  });

  it('reads the four status answers from the evaluator', () => {
    expect(ANSWERS).toEqual(['active', 'inactive', 'not_available', 'no_record']);
  });

  it.each(ANSWERS)('says the status answer %s', (answer) => {
    const reading = READINGS[answer];
    if (reading === undefined) throw new Error(`no reading of ${answer}`);
    expect(statusReadingText(reading).words).toMatch(WORDS);
  });

  it('says a status it cannot read goes to review, never reads as active', () => {
    expect(statusReadingText('not-available').explanation).toMatch(/review/);
  });

  it('reads the flags from the evaluators', () => {
    expect(FLAGS).toEqual([
      'lei-lapsed',
      'active-proposal-to-strike-off',
      'status-unmapped',
      'country-not-covered',
    ]);
  });

  it.each(FLAGS)('says the flag %s, and what it means', (flag) => {
    expect(registryFlagText(flag)?.words).toMatch(WORDS);
    expect(registryFlagText(flag)?.explanation).toMatch(SENTENCE);
  });

  it('says a lapsed LEI is often an unpaid renewal of a live business (C61.2)', () => {
    expect(registryFlagText('lei-lapsed')?.explanation).toMatch(/renewal/);
  });

  it.each(['gleif-ish', 'constructor'])('knows nothing of %s', (value) => {
    expect(registrySourceText(value)).toBeUndefined();
    expect(registryFlagText(value)).toBeUndefined();
    expect(statusReadingText(value)).toBeUndefined();
    expect(businessFieldText(value)).toBeUndefined();
  });

  it('says what a miss means for each kind of register: review, never fraud (V14)', () => {
    expect(businessAuthorityText(true).words).toBe('Yes');
    expect(businessAuthorityText(true).explanation).toMatch(/review/);
    expect(businessAuthorityText(false).words).toBe('No');
    expect(businessAuthorityText(false).explanation).toMatch(/review, never to a failure/);
  });

  it('says what a pass means as `docs/checks/business.md` says it, sentence by sentence', () => {
    const section = passMeansSection('business.md').replaceAll('`', '').toLowerCase();
    const sentences = sentencesOf(DATABASE_BUSINESS_PASS_MEANING);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(section, sentence).toContain(sentence.toLowerCase());
    }
    expect(DATABASE_BUSINESS_PASS_MEANING).toMatch(/^A public register holds an active business/);
    expect(DATABASE_BUSINESS_PASS_MEANING).toMatch(/does not mean the user acts for that business/);
    expect(DATABASE_BUSINESS_PASS_MEANING).toMatch(/goes to review/);
  });

  it('says who a register lists, and the persons with significant control threshold', () => {
    expect(ASSOCIATED_PERSONS_NOTE).toMatch(/officers/);
    expect(ASSOCIATED_PERSONS_NOTE).toMatch(/significant control/);
    expect(ASSOCIATED_PERSONS_NOTE).toMatch(/25%/);
  });
});
