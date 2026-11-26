/**
 * Every vector here is synthetic: a made-up payload with its check digit computed by a separate
 * Python implementation of each published algorithm (no real person's number).
 */
import { describe, expect, it } from 'vitest';
import { NATIONAL_ID_RULES, nationalIdRulesFor } from './national-id-checksums.js';

const VECTORS: readonly (readonly [id: string, valid: string, invalid: string])[] = [
  ['es-dni', '12345678Z', '12345678A'],
  ['es-nie', 'X1234567L', 'X1234567T'],
  ['it-codice-fiscale', 'RSSMRA85T10A562S', 'RSSMRA85T10A562T'],
  ['nl-bsn', '123456782', '123456783'],
  ['be-national-number', '85073003328', '85073003329'],
  ['pl-pesel', '02070803628', '02070803629'],
  ['se-personnummer', '811228-9874', '811228-9875'],
  ['fi-hetu', '131052-308T', '131052-308U'],
  ['no-fodselsnummer', '01019012480', '01019012481'],
  ['pt-cartao-cidadao', '123456780ZZ0', '123456780ZZ1'],
  ['br-cpf', '111.444.777-35', '111.444.777-36'],
  ['cl-rut', '12.345.678-5', '12.345.678-6'],
  ['za-id', '8001015009087', '8001015009088'],
  ['in-aadhaar', '2345 6789 0124', '2345 6789 0125'],
  ['cn-resident-id', '11010519491231002X', '110105194912310021'],
  ['ee-isikukood', '37605030299', '37605030298'],
  ['lt-asmens-kodas', '49001011238', '49001011237'],
  ['tr-kimlik', '10000000146', '10000000147'],
  ['ro-cnp', '1800101221144', '1800101221145'],
  ['hr-oib', '12345678903', '12345678904'],
  ['is-kennitala', '1201743399', '1201743389'],
];

describe('NATIONAL_ID_RULES (C33)', () => {
  it('holds at least 15 checksums, each with a cited source', () => {
    expect(NATIONAL_ID_RULES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(NATIONAL_ID_RULES.map((rule) => rule.id)).size).toBe(NATIONAL_ID_RULES.length);
    for (const rule of NATIONAL_ID_RULES) {
      expect(rule.issuer, rule.id).toMatch(/^[A-Z]{3}$/);
      expect(rule.source.citation.length, rule.id).toBeGreaterThan(10);
      expect(rule.source.url, rule.id).toMatch(/^https:\/\//);
    }
  });

  it('has a vector for every rule', () => {
    expect(VECTORS.map(([id]) => id).sort()).toEqual(NATIONAL_ID_RULES.map((rule) => rule.id).sort());
  });

  it.each(VECTORS)('%s: accepts %j and rejects %j', (id, valid, invalid) => {
    const rule = NATIONAL_ID_RULES.find((candidate) => candidate.id === id);
    expect(rule, id).toBeDefined();
    expect(rule?.shape.test(rule.normalize(valid)), `${id} shape`).toBe(true);
    expect(rule?.isValid(valid), `${id} valid`).toBe(true);
    expect(rule?.isValid(invalid), `${id} invalid`).toBe(false);
  });

  it('rejects values of the wrong shape', () => {
    for (const rule of NATIONAL_ID_RULES) {
      expect(rule.isValid(''), rule.id).toBe(false);
      expect(rule.isValid('ABC'), rule.id).toBe(false);
    }
  });

  it.each([
    ['nl-bsn', '000000000'],
    ['br-cpf', '00000000000'],
    ['br-cpf', '11111111111'],
    ['no-fodselsnummer', '01019012300'],
    ['in-aadhaar', '1234 5678 9012'],
  ])('%s rejects the degenerate %j', (id, value) => {
    expect(NATIONAL_ID_RULES.find((rule) => rule.id === id)?.isValid(value)).toBe(false);
  });

  it('accepts a Belgian number of someone born from 2000 on, and the new Finnish century signs', () => {
    const be = NATIONAL_ID_RULES.find((rule) => rule.id === 'be-national-number');
    expect(be?.isValid('01010112301')).toBe(true);
    const fi = NATIONAL_ID_RULES.find((rule) => rule.id === 'fi-hetu');
    expect(fi?.isValid('010594Y9032')).toBe(true);
  });

  it('finds the rules of an issuer', () => {
    expect(nationalIdRulesFor('ESP').map((rule) => rule.id)).toEqual(['es-dni', 'es-nie']);
    expect(nationalIdRulesFor('D')).toEqual([]);
    expect(nationalIdRulesFor('UTO')).toEqual([]);
  });
});
