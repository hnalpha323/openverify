// @vitest-environment node
import { readFileSync } from 'node:fs';
import { CHIP_INTEGRITY_OUTCOMES, CHIP_REVOCATION_OUTCOMES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import { wordsFor } from './document-words';
import {
  AA_SCHEME_LABELS,
  ACTIVE_AUTHENTICATION_TEXT,
  ANCHOR_MATCH_LABELS,
  CHIP_INTEGRITY_TEXT,
  CHIP_REVOCATION_TEXT,
  DATA_GROUP_STATE_TEXT,
  DEVICE_PROTOCOL_LABELS,
  DEVICE_REPORT_NOTE,
  MRZ_COMPARED_FIELD_LABELS,
  NFC_PASS_MEANS,
  PASSIVE_AUTHENTICATION_FLAG_TEXT,
  REVOCATION_GAP_LABELS,
  SANDBOX_ANCHOR_NOTE,
  dataGroupLabel,
} from './government-id-nfc-words';

/**
 * The chip verifier's own source (`packages/emrtd` and `packages/checks/src/nfc`, which the
 * console does not depend on): the states, outcomes, schemes, protocols, flags and compared
 * fields the results carry are read from it, so a value added there without words here fails.
 */
const source = (path: string) =>
  readFileSync(new URL(`../../../../packages/${path}`, import.meta.url), 'utf8');
const emrtdTypes = source('emrtd/src/types.ts');
const passiveAuthentication = source('emrtd/src/passive-authentication.ts');

/** The string literals of the array assigned to `name` (`const NAME = [...]`). */
function arrayOf(text: string, name: string): string[] {
  const match = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

/** The members of a union of string literals (`type Name = 'a' | 'b';`). */
function unionOf(text: string, name: string): string[] {
  const match = new RegExp(`type ${name} =([^;]*);`).exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

/** The string literals a member's type allows (`readonly name: 'a' | 'b' | null;`). */
function memberOf(text: string, member: string): string[] {
  const match = new RegExp(`readonly ${member}: ([^;]*);`).exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`No ${member} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

/** The flags passive authentication adds (`flags.add('…')`, a ternary of two included). */
const PA_FLAGS = [
  ...new Set(
    passiveAuthentication
      .split('\n')
      .filter((line) => line.includes('flags.add('))
      .flatMap((line) =>
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        [...line.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*)'/g)].map((m) => m[1] ?? ''),
      ),
  ),
];

/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;
/** A sentence. */
const SENTENCE = /^[A-Z].*\.$/;

describe('the chip words (C62, C66)', () => {
  it.each(CHIP_INTEGRITY_OUTCOMES)(
    'says the integrity %s in words, with what it means',
    (state) => {
      expect(CHIP_INTEGRITY_TEXT[state].words).toMatch(WORDS);
      expect(CHIP_INTEGRITY_TEXT[state].explanation).toMatch(SENTENCE);
    },
  );

  it('says broken integrity is proven tampering and a missing one goes to review (C62.3)', () => {
    expect(CHIP_INTEGRITY_TEXT.broken.explanation).toMatch(/tampering/);
    expect(CHIP_INTEGRITY_TEXT.not_established.explanation).toMatch(/review/);
    expect(CHIP_INTEGRITY_TEXT.not_established.explanation).toMatch(/never/);
  });

  it.each(CHIP_REVOCATION_OUTCOMES)('says the revocation %s in words', (state) => {
    expect(CHIP_REVOCATION_TEXT[state].words).toMatch(WORDS);
    expect(CHIP_REVOCATION_TEXT[state].explanation).toMatch(SENTENCE);
  });

  it('reads the integrity and revocation states the verifier gives', () => {
    expect(arrayOf(emrtdTypes, 'INTEGRITY_STATES')).toEqual([...CHIP_INTEGRITY_OUTCOMES]);
    expect(arrayOf(emrtdTypes, 'REVOCATION_STATES')).toEqual([...CHIP_REVOCATION_OUTCOMES]);
  });

  it.each(arrayOf(emrtdTypes, 'REVOCATION_GAPS'))('says the revocation gap %s', (gap) => {
    expect(wordsFor(REVOCATION_GAP_LABELS, gap), gap).toMatch(WORDS);
  });

  it.each(arrayOf(emrtdTypes, 'DATA_GROUP_STATES'))('says the data-group state %s', (state) => {
    expect(wordsFor(DATA_GROUP_STATE_TEXT, state)?.words, state).toMatch(WORDS);
    expect(wordsFor(DATA_GROUP_STATE_TEXT, state)?.explanation, state).toMatch(SENTENCE);
  });

  it('says a data group the signed SOD lists and the client did not send in words', () => {
    expect(DATA_GROUP_STATE_TEXT.missing_from_upload?.words).toBe('Missing from the upload');
    expect(DATA_GROUP_STATE_TEXT.not_listed?.words).toBe('Not listed by the SOD');
  });

  it.each(arrayOf(emrtdTypes, 'ACTIVE_AUTHENTICATION_OUTCOMES'))(
    'says the Active Authentication outcome %s',
    (outcome) => {
      expect(wordsFor(ACTIVE_AUTHENTICATION_TEXT, outcome)?.words, outcome).toMatch(WORDS);
      expect(wordsFor(ACTIVE_AUTHENTICATION_TEXT, outcome)?.explanation, outcome).toMatch(SENTENCE);
    },
  );

  it('never says a chip without an Active Authentication key passed it (decision 33)', () => {
    expect(ACTIVE_AUTHENTICATION_TEXT.not_listed?.explanation).toMatch(/not a pass/);
    expect(ACTIVE_AUTHENTICATION_TEXT.verified?.explanation).toMatch(/present/);
  });

  it.each(memberOf(emrtdTypes, 'scheme'))('names the scheme %s', (scheme) => {
    expect(wordsFor(AA_SCHEME_LABELS, scheme), scheme).toMatch(WORDS);
  });

  it.each(arrayOf(source('checks/src/nfc/inputs.ts'), 'DEVICE_REPORTED_PROTOCOLS'))(
    'names the device-reported protocol %s',
    (protocol) => {
      expect(wordsFor(DEVICE_PROTOCOL_LABELS, protocol), protocol).toMatch(WORDS);
    },
  );

  it('says the device report is what the client claims, never evidence (C62.5)', () => {
    expect(DEVICE_REPORT_NOTE).toMatch(/reported by the client/);
    expect(DEVICE_REPORT_NOTE).toMatch(/never evidence/);
  });

  it.each(memberOf(emrtdTypes, 'matchedBy'))('says how the anchor was chosen: %s', (by) => {
    expect(wordsFor(ANCHOR_MATCH_LABELS, by), by).toMatch(WORDS);
  });

  it('reads the flags passive authentication writes', () => {
    expect(PA_FLAGS).toEqual(
      expect.arrayContaining(['trailing-bytes', 'sha1', 'link-anchor', 'issuer-dn-match']),
    );
    expect(source('checks/src/nfc/id-nfc-passive-authentication-detection.ts')).toContain(
      "'revocation-undetermined'",
    );
  });

  it.each([...PA_FLAGS, 'revocation-undetermined'])('says the flag %s in words', (flag) => {
    expect(wordsFor(PASSIVE_AUTHENTICATION_FLAG_TEXT, flag), flag).toMatch(WORDS);
  });

  it.each(unionOf(source('checks/src/nfc/id-nfc-mrz-comparison.ts'), 'Compared'))(
    'names the compared MRZ field %s',
    (field) => {
      expect(wordsFor(MRZ_COMPARED_FIELD_LABELS, field), field).toMatch(WORDS);
    },
  );

  it('names a data group by its number and what it holds', () => {
    expect(dataGroupLabel('dg1')).toBe('DG1 (MRZ)');
    expect(dataGroupLabel('dg2')).toBe('DG2 (portrait)');
    expect(dataGroupLabel('dg15')).toBe('DG15 (Active Authentication key)');
    expect(dataGroupLabel('dg9')).toBe('DG9');
    expect(dataGroupLabel('not a group')).toBe('not a group');
  });

  it('says what a pass means, and that chip presence needs Active Authentication, as docs/checks/nfc.md does', () => {
    const section = passMeansSection('nfc.md').replaceAll('`', '').toLowerCase();
    const sentences = sentencesOf(NFC_PASS_MEANS);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(section, sentence).toContain(sentence.toLowerCase());
    }
    expect(NFC_PASS_MEANS).toMatch(/bound to the person in the live selfie/);
    expect(NFC_PASS_MEANS).toMatch(/only when Active Authentication passed/);
  });

  it('labels the sandbox anchor as sandbox-only (C62.8)', () => {
    expect(SANDBOX_ANCHOR_NOTE).toMatch(/sandbox-only/i);
    expect(SANDBOX_ANCHOR_NOTE).toMatch(/never/);
  });
});
