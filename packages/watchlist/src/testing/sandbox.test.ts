import { describe, expect, it } from 'vitest';
import {
  contentHash,
  riskDataHash,
  watchlistImportSchema,
  type WatchlistRecord,
} from '../record/index.js';
import { PUBLISHED_TEST_ADDRESSES } from './crypto-addresses.js';
import { isValidImo, isValidLei } from './identifiers.js';
import { SYNTHETIC_LEGAL_FORMS } from './names.js';
import {
  OPENVERIFY_SANDBOX_PEP_SOURCE,
  OPENVERIFY_SANDBOX_SOURCE,
  SANDBOX_LIST_VERSIONS,
  SANDBOX_PEP_MAGIC,
  SANDBOX_WATCHLIST_MAGIC,
  openverifySandboxList,
  openverifySandboxPepList,
} from './sandbox.js';

const byId = (entries: readonly WatchlistRecord[], id: string): WatchlistRecord => {
  const entry = entries.find((candidate) => candidate.entry_id === id);
  if (entry === undefined) {
    throw new Error(`no entry ${id}`);
  }
  return entry;
};

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const M = SANDBOX_WATCHLIST_MAGIC;
const P = SANDBOX_PEP_MAGIC;

describe('openverify-sandbox', () => {
  it('writes every version as a valid import file of the sandbox source, newer each time', () => {
    const published = SANDBOX_LIST_VERSIONS.map((version) => {
      const file = openverifySandboxList(version);
      expect(watchlistImportSchema.parse(file)).toEqual(file);
      expect(file.source).toBe(OPENVERIFY_SANDBOX_SOURCE);
      return file.published_at;
    });
    expect([...published].sort()).toEqual(published);
    expect(new Set(published).size).toBe(published.length);
    expect(openverifySandboxList()).toEqual(openverifySandboxList(1));
  });

  it('holds the magic entries with their documented values', () => {
    const { entries } = openverifySandboxList(1);
    const person = byId(entries, M.listedPerson.entryId);
    expect(person.kind).toBe('individual');
    expect(person.names[0]?.full).toBe('Avery Sandbox Quillfeather');
    expect(person.names.map((name) => name.full)).toContain(M.listedPerson.cyrillicName);
    expect(person.birth_dates).toContainEqual({ value: '1980-04-12', precision: 'day' });
    expect(person.identifiers).toContainEqual({
      kind: 'passport',
      value: M.listedPerson.passport,
      country: 'GB',
    });
    expect(M.listedPerson.query).toEqual({
      'name-first': 'Avery',
      'name-middle': 'Sandbox',
      'name-last': 'Quillfeather',
      birthdate: '1980-04-12',
    });

    const business = byId(entries, M.business.entryId);
    expect(business.kind).toBe('entity');
    expect(business.names[0]?.full).toBe('Sandbox Sanctioned Holdings Ltd');
    expect(business.identifiers).toContainEqual({ kind: 'lei', value: '5299000SANDBOXLEI047' });
    expect(isValidLei(M.business.lei)).toBe(true);
    expect(M.business.query).toEqual({
      term: 'Sandbox Sanctioned Holdings Ltd',
      lei: '5299000SANDBOXLEI047',
    });

    const vessel = byId(entries, M.vessel.entryId);
    expect(vessel.kind).toBe('vessel');
    expect(vessel.identifiers).toContainEqual({ kind: 'imo', value: '9999993' });
    expect(isValidImo(M.vessel.imo)).toBe(true);
    expect(M.vessel.query).toEqual({ term: M.vessel.name, 'imo-number': '9999993' });

    const party = byId(entries, M.cryptoParty.entryId);
    expect(party.names[0]?.full).toBe('Sandbox Listed Party');
    expect(party.crypto_addresses).toEqual(M.cryptoParty.addresses);
    expect(party.crypto_addresses.map(({ raw }) => raw)).toEqual(
      expect.arrayContaining([
        PUBLISHED_TEST_ADDRESSES.eip55Example,
        PUBLISHED_TEST_ADDRESSES.bip173P2wpkh,
      ]),
    );
    expect(M.cryptoParty.query).toEqual({
      'crypto-address': PUBLISHED_TEST_ADDRESSES.eip55Example,
    });
  });

  it('holds an entity listed only on a list other than the SDN List, in every version (K19)', () => {
    for (const version of SANDBOX_LIST_VERSIONS) {
      const entity = byId(openverifySandboxList(version).entries, M.otherListsEntity.entryId);
      expect(entity.kind).toBe('entity');
      expect(entity.names[0]?.full).toBe('Corvanel Sectoral Ironworks');
      expect(entity.list_memberships).toEqual([
        { list: 'Sectoral Sanctions Identifications List', program: 'SANDBOX-SSI-1' },
      ]);
      expect(entity.programs).toEqual(['SANDBOX-SSI-1']);
    }
    expect(M.otherListsEntity.query).toEqual({ term: 'Corvanel Sectoral Ironworks' });
  });

  it('adds the monitored person in version 2, changes its identity in 3 and its risk data in 4', () => {
    const versions = SANDBOX_LIST_VERSIONS.map((version) => openverifySandboxList(version).entries);
    const [v1 = [], v2 = [], v3 = [], v4 = []] = versions;
    expect(v1.some((entry) => entry.entry_id === M.monitoredPerson.entryId)).toBe(false);
    const added = byId(v2, M.monitoredPerson.entryId);
    expect(added.birth_dates).toEqual([{ value: M.monitoredPerson.birthdate, precision: 'day' }]);
    const changed = byId(v3, M.monitoredPerson.entryId);
    expect(changed.birth_dates).toEqual([
      { value: M.monitoredPerson.changedBirthdate, precision: 'day' },
    ]);
    expect(contentHash(changed)).not.toBe(contentHash(added));
    expect(riskDataHash(changed)).toBe(riskDataHash(added));
    const reprogrammed = byId(v4, M.monitoredPerson.entryId);
    expect(reprogrammed.programs).toContain(M.monitoredPerson.addedProgram);
    expect(contentHash(reprogrammed)).toBe(contentHash(changed));
    expect(riskDataHash(reprogrammed)).not.toBe(riskDataHash(changed));
    // The monitored query leaves the birth date out, so version 3 still matches and the
    // dismissal of version 2's match lapses (C89.2) instead of the run losing the entry.
    expect(M.monitoredPerson.query).toEqual({ 'name-first': 'Rowan', 'name-last': 'Fixturedale' });

    const others = (entries: readonly WatchlistRecord[]) =>
      entries
        .filter((entry) => entry.entry_id !== M.monitoredPerson.entryId)
        .map((entry) => [entry.entry_id, contentHash(entry), riskDataHash(entry)]);
    for (const entries of [v2, v3, v4]) {
      expect(others(entries)).toEqual(others(v1));
    }
  });

  it('fills the list so name keys are rare, without any filler sharing a distinctive magic token', () => {
    const { entries } = openverifySandboxList(4);
    expect(entries.length).toBeGreaterThanOrEqual(60);
    const magicIds = new Set([
      M.listedPerson.entryId,
      M.monitoredPerson.entryId,
      M.business.entryId,
      M.vessel.entryId,
      M.cryptoParty.entryId,
      M.otherListsEntity.entryId,
    ]);
    // Legal forms and generic business words are common in any list (and in the fillers); the
    // matcher weighs them down, so only the distinctive tokens must stay unique to the magic names.
    const generic = new Set(['holdings', ...SYNTHETIC_LEGAL_FORMS.flatMap((form) => tokens(form))]);
    const magicTokens = new Set(
      entries
        .filter((entry) => magicIds.has(entry.entry_id))
        .flatMap((entry) => entry.names.flatMap((name) => tokens(name.full)))
        .filter((token) => !generic.has(token)),
    );
    for (const filler of entries.filter((entry) => !magicIds.has(entry.entry_id))) {
      for (const name of filler.names) {
        expect(
          tokens(name.full).filter((token) => magicTokens.has(token)),
          name.full,
        ).toEqual([]);
      }
      expect(filler.crypto_addresses.map(({ raw }) => raw)).not.toContain(
        PUBLISHED_TEST_ADDRESSES.eip55Example,
      );
    }
  });
});

describe('committed sandbox lists', () => {
  it('carry no Han name, which common characters would make real-name-shaped (C89.1)', () => {
    const files = [
      ...SANDBOX_LIST_VERSIONS.map((version) => openverifySandboxList(version)),
      openverifySandboxPepList(),
    ];
    for (const file of files) {
      const scripts = file.entries.flatMap((entry) => entry.names.map((name) => name.script));
      expect(scripts, file.source).not.toContain('han');
    }
  });
});

describe('openverify-sandbox-pep', () => {
  it('is a valid import file of the sandbox PEP source with fictional QIDs', () => {
    const file = openverifySandboxPepList();
    expect(watchlistImportSchema.parse(file)).toEqual(file);
    expect(file.source).toBe(OPENVERIFY_SANDBOX_PEP_SOURCE);
    expect(file.entries.length).toBeGreaterThanOrEqual(50);
    for (const entry of file.entries) {
      expect(entry.entry_id).toMatch(/^Q-test-\d+$/);
      for (const position of entry.positions) {
        expect(position.position).toMatch(/^Q-test-\d+$/);
      }
    }
  });

  it('holds fictional office holders of every class and one relative', () => {
    const { entries } = openverifySandboxPepList();
    const holders = [
      [P.headOfGovernment, 1],
      [P.formerMinister, 1],
      [P.ambassador, 2],
      [P.internationalOrganisationHead, 2],
      [P.stateEnterpriseBoardMember, 3],
      [P.mayor, 4],
    ] as const;
    for (const [holder, pepClass] of holders) {
      const entry = byId(entries, holder.entryId);
      expect(entry.names[0]?.full).toBe(`${holder.givenName} ${holder.familyName}`);
      expect(entry.positions[0]?.pep_class).toBe(pepClass);
      expect(holder.pepClass).toBe(pepClass);
      expect(holder.query['name-first']).toBe(holder.givenName);
      expect(holder.query['name-last']).toBe(holder.familyName);
    }
    const head = byId(entries, P.headOfGovernment.entryId);
    expect(head.positions[0]).toMatchObject({ in_office: 'yes', end: null });
    const former = byId(entries, P.formerMinister.entryId);
    expect(former.positions[0]).toMatchObject({ in_office: 'no', end: P.formerMinister.endedOn });

    const spouse = byId(entries, P.spouse.entryId);
    expect(spouse.positions).toEqual([]);
    expect(spouse.relations).toEqual([
      { relation: 'spouse', entity_id: P.headOfGovernment.entryId },
    ]);
    expect(P.spouse.relationOf).toBe(P.headOfGovernment.entryId);
    expect(spouse.birth_dates).toHaveLength(1);
    // Owner decision 9 after 6B: as a PEP pass derives it, the class of the PEP it relates to.
    expect(spouse.relative_of_class).toBe(P.headOfGovernment.pepClass);
    for (const holder of entries.filter((entry) => entry.relations.length === 0)) {
      expect(holder).not.toHaveProperty('relative_of_class');
    }
  });

  it('keeps fillers clear of every magic name token', () => {
    const { entries } = openverifySandboxPepList();
    const magic = [
      P.headOfGovernment,
      P.spouse,
      P.formerMinister,
      P.ambassador,
      P.internationalOrganisationHead,
      P.stateEnterpriseBoardMember,
      P.mayor,
    ];
    const ids = new Set(magic.map((holder) => holder.entryId));
    const magicTokens = new Set(
      magic.flatMap((holder) => tokens(`${holder.givenName} ${holder.familyName}`)),
    );
    for (const filler of entries.filter((entry) => !ids.has(entry.entry_id))) {
      for (const name of filler.names) {
        expect(
          tokens(name.full).filter((token) => magicTokens.has(token)),
          name.full,
        ).toEqual([]);
      }
    }
  });
});
