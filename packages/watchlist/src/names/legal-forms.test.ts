/**
 * C78.1, C79.2: the legal-form table. The builder is tested on synthetic YAML in the shape of
 * rigour's `org_types.yml`; the committed table is checked against its pinned source.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLegalFormTable,
  parseOrgTypes,
  serialiseLegalFormTable,
  type OrgTypeEntry,
} from './legal-forms-build.js';
import { legalFormAt, legalFormEndingAt, legalFormTable, type LegalFormSource } from './index.js';

const SOURCE: LegalFormSource = {
  repository: 'https://example.test/names',
  commit: '0'.repeat(40),
  path: 'org_types.yml',
  sha256: 'a'.repeat(64),
  license: 'MIT',
  licenseSha256: 'b'.repeat(64),
  licenseText: 'Synthetic licence text',
};

const YAML = [
  'types:',
  '  # a comment about the file',
  '  - display: Ltd',
  '    generic: LLC',
  '    aliases:',
  '      - Limited',
  '      - Ltd.',
  '      - "Limited:" # a quoted alias with a colon',
  '',
  '  - generic: JSC',
  '    compare: ""',
  '    aliases:',
  '      - Public Limited Company',
  '      - ООО # a non-Latin alias',
  '  - display: Kft.',
  '    generic: ""',
  '    aliases:',
  '      - korlátolt felelősségű társaság',
  '',
].join('\n');

describe('parseOrgTypes', () => {
  it('reads each entry, its quoted and commented values, and its aliases', () => {
    expect(parseOrgTypes(YAML)).toEqual<OrgTypeEntry[]>([
      { display: 'Ltd', compare: null, generic: 'LLC', aliases: ['Limited', 'Ltd.', 'Limited:'] },
      {
        display: null,
        compare: '',
        generic: 'JSC',
        aliases: ['Public Limited Company', 'ООО'],
      },
      { display: 'Kft.', compare: null, generic: '', aliases: ['korlátolt felelősségű társaság'] },
    ]);
  });

  it('refuses a shape the file does not use, naming the line', () => {
    expect(() => parseOrgTypes('kinds:\n')).toThrow(/line 1/);
    expect(() => parseOrgTypes('types:\n  - display: A\n    other: B\n')).toThrow(/line 3/);
    expect(() => parseOrgTypes('types:\n  - display: A\n     - stray\n')).toThrow(/line 3/);
    expect(() => parseOrgTypes('types:\n      - before any entry\n')).toThrow(/line 2/);
    expect(() => parseOrgTypes('types:\n  - display: "unterminated\n')).toThrow(/line 2/);
  });
});

describe('buildLegalFormTable', () => {
  it('folds every phrase as name tokens, names each form and sorts the forms by id', () => {
    const table = buildLegalFormTable(parseOrgTypes(YAML), SOURCE);
    expect(table.format).toBe('openverify/legal-forms/v1');
    expect(table.source).toEqual(SOURCE);
    expect(table.forms).toEqual([
      {
        id: 'kft',
        generic: null,
        phrases: ['kft', 'korlatolt felelossegu tarsasag'],
      },
      { id: 'ltd', generic: 'llc', phrases: ['limited', 'ltd'] },
      { id: 'public limited company', generic: 'jsc', phrases: ['public limited company', 'ооо'] },
    ]);
  });

  it('serialises the table as two-space JSON with a final newline', () => {
    const table = buildLegalFormTable(parseOrgTypes(YAML), SOURCE);
    const text = serialiseLegalFormTable(table);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(table);
    expect(text).toContain('\n  "format": "openverify/legal-forms/v1"');
  });
});

describe('the committed table (rigour org_types.yml @ 607fa82, MIT)', () => {
  it('records its pinned source and licence', () => {
    const { format, source, forms } = legalFormTable();
    expect(format).toBe('openverify/legal-forms/v1');
    expect(source).toMatchObject({
      repository: 'https://github.com/opensanctions/rigour',
      commit: '607fa82b1ba3338c5e2e04f81c3a77e8cbbe0ee7',
      path: 'resources/names/org_types.yml',
      sha256: '772d6c6cf48af7a5b4832ac9aab1e293f0002111f2abb9588377a0459f087f20',
      license: 'MIT',
    });
    expect(source.licenseText).toContain('Permission is hereby granted, free of charge');
    expect(forms.length).toBeGreaterThan(400);
    expect(new Set(forms.map((form) => form.id)).size).toBe(forms.length);
    for (const form of forms) {
      expect(form.phrases.length).toBeGreaterThan(0);
      expect(form.phrases.every((phrase) => phrase !== '' && phrase.trim() === phrase)).toBe(true);
    }
  });

  it('finds the longest legal form at the start or the end of a token list', () => {
    expect(legalFormAt(['public', 'limited', 'company', 'acme'], 0)).toEqual({
      length: 3,
      key: 'g:jsc',
    });
    expect(legalFormEndingAt(['acme', 'ltd'], 2)).toEqual({ length: 1, key: 'g:llc' });
    expect(legalFormEndingAt(['acme', 'limited'], 2)).toEqual({ length: 1, key: 'g:llc' });
    expect(legalFormAt(['ооо', 'ромашка'], 0)).toEqual({ length: 1, key: 'g:llc' });
    expect(legalFormEndingAt(['acme', 'trading'], 2)).toBeNull();
  });

  it('falls back to C58 company types rigour does not list', () => {
    expect(legalFormEndingAt(['acme', 'corporation'], 2)?.key).toMatch(/^c:/);
  });
});
