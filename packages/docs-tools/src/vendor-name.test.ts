import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from './repository.js';
import { DOCS_SWITCHES, MIGRATION_PAGES } from './switches.js';
import {
  VENDOR_NAME_EXEMPT,
  checkVendorName,
  vendorNameExempt,
  vendorNameFindings,
  vendorNameScope,
} from './vendor-name.js';

const lines = (text: string) =>
  vendorNameFindings('docs/x.md', text).map((finding) => finding.line);

describe('the vendor-name rule', () => {
  it.each([
    'Modelled on Persona.',
    'the PERSONA dashboard',
    'Send the Persona-Version header.',
    'Verify Persona-Signature first.',
    'Point it at withpersona.com.',
    'see api.withpersona.com/api/v1',
  ])('finds the name as a word or the host: %s', (line) => {
    expect(lines(line)).toEqual([1]);
  });

  it.each([
    '/home/user/persona-opensource/docs/a.md',
    'cd persona-opensource && pnpm test',
    'scratch path -home-user-persona-opensource/x',
    'docs/research/persona-surface.md indexes it',
    'the event `inquiry.reusable-persona-created` is not built',
    'a `from-reusable-persona` start is not built',
    'personal data and personas in general',
  ])('accepts a path, an identifier or another word: %s', (line) => {
    expect(lines(line)).toEqual([]);
  });

  it('names every line that holds a hit', () => {
    expect(lines('fine\nPersona here\nfine\nand Persona again')).toEqual([2, 4]);
  });

  it('exempts the records and the evidence, and the vendor-named page only while the switch is on', () => {
    expect(VENDOR_NAME_EXEMPT).toEqual([
      'docs/research/',
      'docs/plans/',
      'docs/PLAN.md',
      'docs/PROGRESS.md',
      'docs/adr/',
      'docs/tdd/',
    ]);
    expect(vendorNameExempt('docs/research/persona-surface.md')).toBe(true);
    expect(vendorNameExempt('docs/tdd/phase0-verify.tdd.md')).toBe(true);
    expect(vendorNameExempt('docs/PLAN.md')).toBe(true);
    expect(vendorNameExempt('docs/PLAN.md.bak')).toBe(false);
    expect(vendorNameExempt('docs/security/README.md')).toBe(false);
    // Q8 granted (2026-11-21): the committed switch is on, so the vendor-named page is exempt.
    expect(vendorNameExempt(MIGRATION_PAGES.vendorNamed)).toBe(true);
    expect(
      vendorNameExempt(MIGRATION_PAGES.vendorNamed, { ...DOCS_SWITCHES, vendorNaming: false }),
    ).toBe(false);
  });

  it('reads a link to the vendor-named page as its path only while the switch is on (Q8)', () => {
    const link = 'The whole mapping is [the migration page](../migration/from-persona.md).';
    expect(vendorNameFindings('docs/connect/mapping.md', link)).toEqual([]);
    expect(
      vendorNameFindings('docs/connect/mapping.md', link, {
        ...DOCS_SWITCHES,
        vendorNaming: false,
      }),
    ).toHaveLength(1);
    expect(
      vendorNameFindings('docs/connect/mapping.md', 'Persona names it here.').map(
        (finding) => finding.message,
      ),
    ).toEqual(['names the vendor outside the vendor-named migration page (Q8, C280.6)']);
  });

  it('reads the text files under docs/ outside the exempt paths', () => {
    const repo = createMemoryRepository({
      'docs/a.md': 'Persona',
      'docs/b.json': '{"name": "Persona"}',
      'docs/c.png': 'Persona',
      'docs/plans/p.md': 'Persona',
      'docs/tdd/t.md': 'Persona',
      'README.md': 'Persona',
    });

    expect(vendorNameScope(repo)).toEqual(['docs/a.md', 'docs/b.json']);
    expect(checkVendorName(repo).findings.map((finding) => finding.path)).toEqual([
      'docs/a.md',
      'docs/b.json',
    ]);
  });

  it('holds over docs/ today, with the one Phase 0 use left in the exempt evidence', () => {
    const repo = createRepository(REPOSITORY_ROOT);

    expect(checkVendorName(repo)).toEqual({ name: 'vendor-name', status: 'built', findings: [] });
    const evidence = vendorNameFindings(
      'docs/tdd/phase0-verify.tdd.md',
      repo.readText('docs/tdd/phase0-verify.tdd.md'),
    );
    expect(evidence.length).toBeGreaterThan(0);
  });
});
