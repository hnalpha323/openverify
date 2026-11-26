/**
 * C78.3: the variant-group filter, the filtered file and its loader, on synthetic groups (every
 * id here is fictional; the forms are common given names).
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isHeldOutGroup } from '../record/index.js';
import {
  SHIPPED_VARIANT_GROUPS_SHA256,
  RIGOUR_LICENSE,
  VARIANT_GROUPS_FORMAT,
  filterVariantGroups,
  loadVariantGroups,
  parseRigourPersonNames,
  parseVariantGroups,
  rigourLicenseText,
  serialiseVariantGroups,
  variantFormsOf,
  variantGroupsFrom,
  type VariantGroup,
} from './index.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('variantFormsOf', () => {
  it('stores a Latin form in both renderings and any other in its original script', () => {
    expect(variantFormsOf('Müller')).toEqual(['muller', 'mueller']);
    expect(variantFormsOf('Иван')).toEqual(['иван']);
    expect(variantFormsOf('カール')).toEqual(['カール']);
  });

  it('joins a form of several words, and drops one of no handled script', () => {
    expect(variantFormsOf('abd al-rahman')).toEqual(['abdalrahman']);
    expect(variantFormsOf('Ivаn')).toEqual([]);
    expect(variantFormsOf('ꦗꦮ')).toEqual([]);
    expect(variantFormsOf('1980')).toEqual([]);
    expect(variantFormsOf('ivan иван')).toEqual([]);
  });
});

describe('parseRigourPersonNames', () => {
  it('reads one group per line, `forms => id`, and skips blank lines', () => {
    expect(parseRigourPersonNames('ivan, иван => Q101\n\nmaria, мария => X7\n')).toEqual([
      ['Q101', ['ivan', 'иван']],
      ['X7', ['maria', 'мария']],
    ]);
  });

  it('refuses a line without its id, naming the line', () => {
    expect(() => parseRigourPersonNames('ivan => Q1\nivan, ivana\n')).toThrow(/line 2/);
    expect(() => parseRigourPersonNames('ivan => \n')).toThrow(/line 1/);
  });
});

describe('filterVariantGroups', () => {
  it('drops oversized groups, unhandled forms and groups left with fewer than two forms', () => {
    const oversized = Array.from({ length: 61 }, (_, index) => `name${String(index)}x`);
    const { groups, report } = filterVariantGroups([
      ['Q3', ['maria', 'мария', 'Maria']],
      ['Q1', oversized],
      ['Q2', ['ivan', 'Ivаn']],
      ['Q4', ['Müller', 'muller']],
    ]);
    expect(groups).toEqual([
      ['Q3', ['maria', 'мария']],
      ['Q4', ['muller', 'mueller']],
    ]);
    expect(report).toEqual({
      inputGroups: 4,
      keptGroups: 2,
      keptForms: 4,
      droppedOversize: 1,
      droppedHeldOut: 0,
      droppedTooFewForms: 1,
      droppedForms: 1,
    });
  });

  it('with a hold-out seed, drops exactly the groups isHeldOutGroup selects (V12)', () => {
    const input: VariantGroup[] = Array.from({ length: 60 }, (_, index) => [
      `Q${String(1000 + index)}`,
      ['ivan', 'иван'],
    ]);
    const seed = 'synthetic-evaluation-seed';
    const held = input.filter(([id]) => isHeldOutGroup(id, seed)).map(([id]) => id);
    expect(held.length).toBeGreaterThan(0);
    const { groups, report } = filterVariantGroups(input, { holdOutSeed: seed });
    expect(groups.map(([id]) => id)).toEqual(
      input.map(([id]) => id).filter((id) => !held.includes(id)),
    );
    expect(report.droppedHeldOut).toBe(held.length);
    expect(filterVariantGroups(input).groups).toHaveLength(60);
  });
});

describe('the filtered file', () => {
  const groups: VariantGroup[] = [
    ['Q101', ['ivan', 'иван']],
    ['Q102', ['ivan', 'iwan']],
  ];
  const text = serialiseVariantGroups(groups, { sourceSha256: 'c'.repeat(64), heldOut: false });

  it('is one JSON document with a group per line', () => {
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n').filter((line) => line.startsWith('["Q'))).toHaveLength(2);
    expect(JSON.parse(text)).toMatchObject({
      format: VARIANT_GROUPS_FORMAT,
      source: { name: 'rigour_person_names', sha256: 'c'.repeat(64) },
      heldOut: false,
    });
  });

  it('reads back with its digest and finds the groups of each form', () => {
    const read = parseVariantGroups(Buffer.from(text, 'utf8'));
    expect(read.sha256).toBe(sha256(text));
    expect(read.groupCount).toBe(2);
    expect(read.formCount).toBe(3);
    expect(read.groupsOf('ivan')).toEqual(['Q101', 'Q102']);
    expect(read.groupsOf('иван')).toEqual(['Q101']);
    expect(read.groupsOf('maria')).toEqual([]);
  });

  it('refuses a file of another format', () => {
    expect(() => parseVariantGroups(Buffer.from('{"format":"other","groups":[]}'))).toThrow(
      /format/,
    );
    expect(() => parseVariantGroups(Buffer.from('not json'))).toThrow();
  });

  it('carries the MIT notice of its source after the members the benchmarks read (owner decision 19 after 6B)', () => {
    const licensed = serialiseVariantGroups(groups, {
      sourceSha256: 'c'.repeat(64),
      heldOut: false,
      license: { ...RIGOUR_LICENSE, licenseText: rigourLicenseText() },
    });
    const head = JSON.parse(licensed) as Record<string, unknown>;
    expect(Object.keys(head)).toEqual([
      'format',
      'source',
      'heldOut',
      'maxForms',
      'license',
      'copyright',
      'licenseText',
      'groups',
    ]);
    expect(head).toMatchObject({ format: VARIANT_GROUPS_FORMAT, license: 'MIT' });
    expect(head.copyright).toBe(RIGOUR_LICENSE.copyright);
    expect(String(head.licenseText)).toContain(RIGOUR_LICENSE.copyright);
    expect(parseVariantGroups(Buffer.from(licensed, 'utf8')).groupsOf('ivan')).toEqual([
      'Q101',
      'Q102',
    ]);
  });

  it('reads the MIT text of rigour pinned by its digest', () => {
    const text = rigourLicenseText();
    expect(sha256(text)).toBe(RIGOUR_LICENSE.sha256);
    expect(text.startsWith('MIT License')).toBe(true);
  });

  it('can be built in memory from written forms', () => {
    const memory = variantGroupsFrom([['Q9', ['Müller', 'Miller']]], 'd'.repeat(64));
    expect(memory.groupsOf('mueller')).toEqual(['Q9']);
    expect(memory.groupsOf('miller')).toEqual(['Q9']);
    expect(memory.sha256).toBe('d'.repeat(64));
  });
});

describe('loadVariantGroups', () => {
  const directory = mkdtempSync(join(tmpdir(), 'variant-groups-'));
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const text = serialiseVariantGroups([['Q101', ['ivan', 'иван']]], {
    sourceSha256: 'c'.repeat(64),
    heldOut: false,
  });
  const path = join(directory, 'variant-groups.json');
  writeFileSync(path, text);

  it('answers missing, unexpected or loaded, never throwing', () => {
    expect(loadVariantGroups(join(directory, 'absent.json'))).toEqual({ status: 'missing' });
    expect(loadVariantGroups(path, 'e'.repeat(64))).toEqual({
      status: 'unexpected',
      sha256: sha256(text),
    });
    const loaded = loadVariantGroups(path, sha256(text));
    expect(loaded.status).toBe('loaded');
    expect(loaded.status === 'loaded' && loaded.groups.groupsOf('ivan')).toEqual(['Q101']);
  });

  it('pins the digest of the shipped build', () => {
    expect(SHIPPED_VARIANT_GROUPS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(loadVariantGroups(path)).toEqual({ status: 'unexpected', sha256: sha256(text) });
  });
});
