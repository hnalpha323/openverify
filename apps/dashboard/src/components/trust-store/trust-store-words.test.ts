// @vitest-environment node
import { readFileSync } from 'node:fs';
import { TRUST_ANCHOR_SYNC_OUTCOMES, TRUST_CRL_FRESHNESS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { wordsFor } from '../../lib/document-words';
import {
  CRL_FRESHNESS_LABELS,
  SYNC_OUTCOME_LABELS,
  SYNC_REASON_WORDS,
  TRUST_SOURCE_LABELS,
  TRUST_STORE_SETTING_WORDS,
  countryName,
} from './trust-store-words';

/**
 * The reason codes `trust_anchor_syncs` records, read from the code that writes them (the sync
 * in `apps/api`, the trust-store repository in `packages/db` and the master-list failures of
 * `packages/emrtd`), so a code added there without words here fails this test.
 */
const repo = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const sync = repo('apps/api/src/trust-anchors/sync.ts');
const repository = repo('packages/db/src/repositories/trust-anchors.ts');
const emrtdTypes = repo('packages/emrtd/src/types.ts');

const snakeLiterals = (text: string) =>
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  [...text.matchAll(/'([a-z]+(?:_[a-z0-9]+)+)'/g)].map((match) => match[1] ?? '');

function arrayOf(text: string, name: string): string[] {
  const match = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

const SYNC_REASONS = [
  ...new Set([
    ...snakeLiterals(sync),
    ...[...repository.matchAll(/refused\('([a-z_]+)'\)|reason: '([a-z_]+)'/g)].map(
      (match) => match[1] ?? match[2] ?? '',
    ),
    ...snakeLiterals(repository).filter((code) => code.startsWith('crl_')),
    ...arrayOf(emrtdTypes, 'MASTER_LIST_FAILURES'),
  ]),
];

/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;

describe('the trust store words (C62.7, C62.10)', () => {
  it.each(TRUST_ANCHOR_SYNC_OUTCOMES)('says the sync outcome %s', (outcome) => {
    expect(SYNC_OUTCOME_LABELS[outcome]).toMatch(WORDS);
  });

  it.each(TRUST_CRL_FRESHNESS)('says the CRL freshness %s', (freshness) => {
    expect(CRL_FRESHNESS_LABELS[freshness]).toMatch(WORDS);
  });

  it('reads the reasons the sync, the repository and the master-list check record', () => {
    expect(SYNC_REASONS).toEqual(
      expect.arrayContaining([
        'root_pin_mismatch',
        'list_signing_time_rollback',
        'source_unknown',
        'crl_number_rollback',
        'crl_not_current',
        'signer_not_issued_by_root',
      ]),
    );
  });

  it.each(SYNC_REASONS)('says the sync reason %s in words', (reason) => {
    expect(wordsFor(SYNC_REASON_WORDS, reason), reason).toMatch(WORDS);
  });

  it.each([
    ...(
      JSON.parse(repo('trust-anchors/manifest.json')) as { sources: { id: string }[] }
    ).sources.map((source) => source.id),
    'openverify-sandbox',
    'operator-import',
  ])('names the source %s', (source) => {
    expect(wordsFor(TRUST_SOURCE_LABELS, source), source).toMatch(WORDS);
  });

  it('names a country in English, Utopia as the test issuer, and keeps a code it cannot name', () => {
    expect(countryName('DE')).toBe('Germany');
    expect(countryName('FR')).toBe('France');
    expect(countryName('UT')).toBe('Utopia (test issuer)');
    expect(countryName('not a code')).toBe('not a code');
  });

  it('says each install setting in words, naming its variable (Workflow 5C review K13)', () => {
    const { refresh, icaoCrls } = TRUST_STORE_SETTING_WORDS;
    for (const value of [refresh.on, refresh.off, icaoCrls.on, icaoCrls.off]) {
      expect(value).toMatch(WORDS);
    }
    expect(refresh.explanation.on).toMatch(/OPENVERIFY_TRUST_ANCHOR_REFRESH=true/);
    expect(refresh.explanation.off).toMatch(/OPENVERIFY_TRUST_ANCHOR_REFRESH is false/);
    expect(icaoCrls.explanation.on).toMatch(/OPENVERIFY_NFC_ALLOW_ICAO_CRLS=true/);
    expect(icaoCrls.explanation.off).toMatch(/OPENVERIFY_NFC_ALLOW_ICAO_CRLS is false/);
  });
});
