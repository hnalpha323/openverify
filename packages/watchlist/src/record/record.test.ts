/**
 * C77.1, C77.3, C77.5, C78.3: the frozen record, its hashes and the held-out rule. The golden
 * vectors come from an independent implementation of the canonical JSON rule (sorted keys, NFC
 * strings, set-like arrays sorted by their canonical JSON in UTF-16 code-unit order, no
 * whitespace), run once and pasted here; every name, number and address is fictional.
 */
import { describe, expect, it } from 'vitest';
import { variantGroupsFrom } from '../keys/index.js';
import { personSubject, screenCandidates } from '../match/index.js';
import { resolveNameMatching } from '../score/index.js';
import {
  HELD_OUT_BYTE_THRESHOLD,
  WATCHLIST_ENTRY_KINDS,
  WATCHLIST_RECORD_LIMITS,
  canonicalJson,
  contentHash,
  isHeldOutGroup,
  riskDataHash,
  watchlistImportSchema,
  watchlistRecordSchema,
  type WatchlistRecord,
} from './index.js';

const RECORD: WatchlistRecord = {
  entry_id: 'SBX-1001',
  kind: 'individual',
  names: [
    {
      full: 'QUILLFEATHER, Avery Sandbox',
      parts: [
        { role: 'family', value: 'QUILLFEATHER' },
        { role: 'given', value: 'Avery' },
        { role: 'middle', value: 'Sandbox' },
      ],
      script: 'latin',
      quality: 'strong',
      primary: true,
    },
    { full: 'Квиллфезер Эйвери', parts: [], script: 'cyrillic', quality: 'strong', primary: false },
    { full: 'Avy Q.', parts: [], script: 'latin', quality: 'weak', primary: false },
  ],
  birth_dates: [
    { value: '1980-04-12', precision: 'day' },
    { value: '1980', precision: 'year', range: { from: '1979', to: '1981' } },
  ],
  birth_places: ['Sandbox City'],
  countries: [
    { code: 'GB', role: 'nationality' },
    { code: null, role: 'residence' },
  ],
  gender: 'female',
  identifiers: [{ kind: 'passport', value: 'SBX123456', country: 'GB' }],
  addresses: [
    { country: 'GB', city: 'Sandbox City', postcode: 'ZZ99 9ZZ', lines: ['1 Synthetic Lane'] },
  ],
  crypto_addresses: [{ raw: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266', ticker: 'ETH' }],
  programs: ['SANDBOX-PROGRAM-1', 'SANDBOX-PROGRAM-2'],
  listed_at: '2024-01-15',
  positions: [],
  relations: [],
  remarks: 'Synthetic entry for tests.',
};

const PEP: WatchlistRecord = {
  entry_id: 'Q-test-1001',
  kind: 'individual',
  names: [
    { full: 'Marlowe Testerton', parts: [], script: 'latin', quality: 'strong', primary: true },
  ],
  birth_dates: [],
  birth_places: [],
  countries: [],
  identifiers: [],
  addresses: [],
  crypto_addresses: [],
  programs: [],
  positions: [
    {
      position: 'Q-test-2001',
      label: 'Minister of Synthetic Affairs',
      pep_class: 1,
      country: 'GB',
      start: '2024-01-15',
      end: null,
      in_office: 'yes',
    },
  ],
  relations: [],
};

const copy = <T>(value: T): T => structuredClone(value);

/** Replaces the first item of a list with an edited copy. */
function editFirst<T>(items: T[], edit: (item: T) => T): void {
  const [item] = items;
  if (item === undefined) {
    throw new Error('the list is empty');
  }
  items[0] = edit(item);
}

describe('the normalised record (C77.1)', () => {
  it('parses a full synthetic record and a PEP record', () => {
    expect(watchlistRecordSchema.parse(RECORD)).toEqual(RECORD);
    expect(watchlistRecordSchema.parse(PEP)).toEqual(PEP);
    expect(WATCHLIST_ENTRY_KINDS).toEqual(['individual', 'entity', 'vessel', 'aircraft']);
  });

  it('caps every string: names 300, addresses 500, identifiers 100', () => {
    expect(WATCHLIST_RECORD_LIMITS).toMatchObject({ name: 300, address: 500, identifier: 100 });
    const long = copy(RECORD);
    editFirst(long.names, (item) => ({ ...item, full: 'x'.repeat(301) }));
    expect(watchlistRecordSchema.safeParse(long).success).toBe(false);
    const address = copy(RECORD);
    editFirst(address.addresses, (item) => ({ ...item, lines: ['x'.repeat(501)] }));
    expect(watchlistRecordSchema.safeParse(address).success).toBe(false);
    const identifier = copy(RECORD);
    editFirst(identifier.identifiers, (item) => ({ ...item, value: 'x'.repeat(101) }));
    expect(watchlistRecordSchema.safeParse(identifier).success).toBe(false);
  });

  it('refuses unknown members, kinds and roles, and a date that does not fit its precision', () => {
    expect(watchlistRecordSchema.safeParse({ ...RECORD, nickname: 'x' }).success).toBe(false);
    expect(watchlistRecordSchema.safeParse({ ...RECORD, kind: 'person' }).success).toBe(false);
    const role = copy(RECORD);
    role.countries[0] = {
      code: 'GB',
      role: 'origin',
    } as unknown as WatchlistRecord['countries'][number];
    expect(watchlistRecordSchema.safeParse(role).success).toBe(false);
    const date = copy(RECORD);
    date.birth_dates[0] = { value: '1980-04', precision: 'day' };
    expect(watchlistRecordSchema.safeParse(date).success).toBe(false);
    const quality = copy(RECORD);
    editFirst(quality.names, (item) => ({ ...item, quality: 'low' }) as unknown as typeof item);
    expect(watchlistRecordSchema.safeParse(quality).success).toBe(false);
    expect(watchlistRecordSchema.safeParse({ ...RECORD, names: [] }).success).toBe(false);
  });

  it('reads the normalised import format { source, published_at, entries } (C77.5)', () => {
    const file = {
      source: 'openverify-sandbox',
      published_at: '2026-10-26T00:00:00.000Z',
      entries: [RECORD, PEP],
    };
    expect(watchlistImportSchema.parse(file)).toEqual(file);
    expect(watchlistImportSchema.safeParse({ ...file, source: 'OFAC SDN' }).success).toBe(false);
    expect(watchlistImportSchema.safeParse({ ...file, published_at: '2026-10-26' }).success).toBe(
      false,
    );
    expect(
      watchlistImportSchema.safeParse({
        ...file,
        entries: [RECORD, { ...PEP, entry_id: RECORD.entry_id }],
      }).success,
    ).toBe(false);
  });
});

describe('canonicalJson (C77.3)', () => {
  it('sorts keys, normalises strings to NFC, keeps array order and writes no whitespace', () => {
    expect(canonicalJson({ b: 1, a: ['é', 'z', 'a'], c: { y: null, x: true } })).toBe(
      '{"a":["é","z","a"],"b":1,"c":{"x":true,"y":null}}',
    );
    expect(canonicalJson({ name: 'Á' })).toBe(canonicalJson({ name: 'Á' }));
    expect(canonicalJson({ gone: undefined, kept: 'x' })).toBe('{"kept":"x"}');
  });
});

describe('contentHash (C77.3)', () => {
  it('matches the golden vector', () => {
    expect(contentHash(RECORD)).toBe(
      '5447611558cae8845743e579fda6806d8982aadd680385c86f24d827bcc2803a',
    );
    expect(contentHash(PEP)).toBe(
      '7b990a4ce0ee07cf39ef7b20021ba321cde42a36fde08d3520893729f96a4272',
    );
  });

  it('ignores the order of aliases, programmes and remarks, so they never lapse a dismissal', () => {
    const edited = copy(RECORD);
    edited.names.reverse();
    edited.programs = ['SANDBOX-PROGRAM-2', 'SANDBOX-PROGRAM-1', 'SANDBOX-PROGRAM-1'];
    edited.remarks = 'Changed remark';
    edited.addresses = [];
    expect(contentHash(edited)).toBe(contentHash(RECORD));
  });

  it('changes when what matching reads changes, and not with Unicode composition', () => {
    const birthdate = copy(RECORD);
    birthdate.birth_dates[0] = { value: '1980-04-13', precision: 'day' };
    expect(contentHash(birthdate)).toBe(
      '95f6fd44ea738a513e2087b65b88be901a8ced4650af4d3b39d20008b8a9ab2b',
    );
    const decomposed = copy(RECORD);
    editFirst(decomposed.names, (item) => ({ ...item, full: 'QUILLFEATHER, Ávery Sandbox' }));
    const composed = copy(RECORD);
    editFirst(composed.names, (item) => ({ ...item, full: 'QUILLFEATHER, Ávery Sandbox' }));
    expect(contentHash(decomposed)).toBe(contentHash(composed));
    expect(contentHash(composed)).toBe(
      'ba850dbef5e1e1de21e02f75c6e538e174ea850026f4e594d132b570e7a9a256',
    );
  });
});

describe('riskDataHash (C77.3, V06)', () => {
  it('matches the golden vectors', () => {
    expect(riskDataHash(RECORD)).toBe(
      '871585eda4ec0850ab6f731d50a09dd90064f5d4e4348bdef480f62380d491a3',
    );
    expect(riskDataHash(PEP)).toBe(
      '8c4415111689f4667faa27ee95d71bef9dcefc56775ccd21176e3f1bccf3e2c0',
    );
  });

  it('changes with a new programme, a PEP leaving office or a relation, not with order or a label', () => {
    const program = copy(RECORD);
    program.programs.push('SANDBOX-PROGRAM-3');
    expect(riskDataHash(program)).toBe(
      '1ac274b8dd8a4934a0b1076b953fca5d6aa9ac5170684612f4a42561b2764fa8',
    );
    expect(contentHash(program)).toBe(contentHash(RECORD));
    const reordered = copy(RECORD);
    reordered.programs = ['SANDBOX-PROGRAM-2', 'SANDBOX-PROGRAM-1', 'SANDBOX-PROGRAM-1'];
    expect(riskDataHash(reordered)).toBe(riskDataHash(RECORD));
    const left = copy(PEP);
    editFirst(left.positions, (item) => ({ ...item, in_office: 'no' as const, end: '2026-01-01' }));
    expect(riskDataHash(left)).toBe(
      '3058c39449a120c6a0d71217633c62b1e688a82cfc2c0486e4f817ea1b4bacf4',
    );
    const relabelled = copy(PEP);
    editFirst(relabelled.positions, (item) => ({
      ...item,
      label: 'Relabelled synthetic ministry',
    }));
    expect(riskDataHash(relabelled)).toBe(riskDataHash(PEP));
    const related = copy(PEP);
    related.relations = [{ relation: 'spouse', entity_id: 'Q-test-1002' }];
    expect(riskDataHash(related)).toBe(
      '62eeb051a20a8298fe5baba24a9a97b05dea54f76b71c3fc76bc844d470b4165',
    );
  });
});

/** An OFAC Consolidated entry: the same record on two non-SDN lists (owner decision 9 after 6B). */
const LISTED: WatchlistRecord = {
  ...RECORD,
  list_memberships: [
    { list: 'Sectoral Sanctions Identifications List', program: 'SANDBOX-PROGRAM-1' },
    { list: 'Non-SDN Menu-Based Sanctions List', program: null },
  ],
};

/** A PEP relative: no position, a family link to the PEP above and that PEP's class. */
const RELATIVE: WatchlistRecord = {
  ...PEP,
  entry_id: 'Q-test-1003',
  names: [
    { full: 'Rowan Testerton', parts: [], script: 'latin', quality: 'strong', primary: true },
  ],
  positions: [],
  relations: [{ relation: 'spouse', entity_id: 'Q-test-1001' }],
  relative_of_class: 1,
};

const without = (
  record: WatchlistRecord,
  member: 'list_memberships' | 'relative_of_class',
): WatchlistRecord => {
  const copied = copy(record);
  if (member === 'list_memberships') {
    delete copied.list_memberships;
  } else {
    delete copied.relative_of_class;
  }
  return copied;
};

describe('the risk-data members of owner decision 9 after Workflow 6B', () => {
  it('parses list_memberships and relative_of_class, and refuses what they cannot mean', () => {
    expect(watchlistRecordSchema.parse(LISTED)).toEqual(LISTED);
    expect(watchlistRecordSchema.parse(RELATIVE)).toEqual(RELATIVE);
    const refused = (record: unknown) => watchlistRecordSchema.safeParse(record).success;
    expect(refused({ ...RECORD, list_memberships: [] })).toBe(false);
    expect(refused({ ...RECORD, list_memberships: [{ list: 'SSI' }] })).toBe(false);
    expect(
      refused({ ...RECORD, list_memberships: [{ list: 'SSI', program: null, kind: 'x' }] }),
    ).toBe(false);
    expect(refused({ ...RELATIVE, relative_of_class: 0 })).toBe(false);
    expect(refused({ ...RELATIVE, relative_of_class: 5 })).toBe(false);
    expect(refused({ ...RELATIVE, relative_of_class: 1.5 })).toBe(false);
    // A class says whose relative the entry is, so it needs the family link it came from.
    expect(refused({ ...RELATIVE, relations: [] })).toBe(false);
  });

  it('enter the risk-data hash only when present, and never the content hash', () => {
    expect(riskDataHash(without(LISTED, 'list_memberships'))).toBe(riskDataHash(RECORD));
    expect(riskDataHash(LISTED)).toBe(
      'bab2e9da67834c698435482dd386b883a8c7e5b5cd1a5f7456410c10f7f448c6',
    );
    expect(contentHash(LISTED)).toBe(contentHash(RECORD));
    const reordered = copy(LISTED);
    reordered.list_memberships?.reverse();
    expect(riskDataHash(reordered)).toBe(riskDataHash(LISTED));

    expect(riskDataHash(without(RELATIVE, 'relative_of_class'))).toBe(
      '498689eafe76e8cb6c5224390418e219795e88307c81383686153b48c79f642a',
    );
    expect(riskDataHash(RELATIVE)).toBe(
      '75ba0e0dff828687cc6618692d50f338d9fcd073cdb00b8fd0162ed465ec57f0',
    );
    expect(riskDataHash({ ...RELATIVE, relative_of_class: 2 })).toBe(
      'c0880d04aff779022405b82e9536af969937c8a35ec484f882dfd4dfc0ba1062',
    );
    expect(contentHash(RELATIVE)).toBe(contentHash(without(RELATIVE, 'relative_of_class')));
  });
});

describe('the risk-data members and the score (owner decision 9 after Workflow 6B)', () => {
  it('change no score: a subject matches a record the same with them as without', () => {
    const options = {
      nameMatching: resolveNameMatching({ preset: 'tolerant' }),
      birthdateMatching: 'year_plus_minus_one',
      birthdateFilter: 'penalty',
      countryFields: ['birthplace', 'citizenship', 'nationality', 'residency'],
      countryFilter: 'penalty',
      screenWeakAliases: true,
      groups: variantGroupsFrom([], 'a'.repeat(64)),
    } as const;
    const screened = (record: WatchlistRecord, query: Parameters<typeof personSubject>[0]) =>
      screenCandidates(personSubject(query), [{ sourceId: 'openverify-sandbox', record }], options);

    const avery = { 'name-first': 'Avery', 'name-last': 'Quillfeather', birthdate: '1980-04-12' };
    expect(screened(LISTED, avery)).toEqual(screened(RECORD, avery));
    expect(screened(LISTED, avery)).toHaveLength(1);
    const rowan = { 'name-first': 'Rowan', 'name-last': 'Testerton' };
    expect(screened(RELATIVE, rowan)).toEqual(
      screened(without(RELATIVE, 'relative_of_class'), rowan),
    );
    expect(screened(RELATIVE, rowan)).toHaveLength(1);
  });
});

describe('isHeldOutGroup (C78.3, V12)', () => {
  it('holds out the groups whose SHA-256 over the seed and the id starts below byte 26', () => {
    expect(HELD_OUT_BYTE_THRESHOLD).toBe(26);
    for (const group of ['Q14', 'Q22', 'Q45', 'Q64', 'Q71']) {
      expect(isHeldOutGroup(group, 'evaluation-6-seed-a'), group).toBe(true);
    }
    for (const group of ['Q42', 'Q5837762', 'Q17497922', 'X123']) {
      expect(isHeldOutGroup(group, 'evaluation-6-seed-a'), group).toBe(false);
    }
    expect(isHeldOutGroup('X123', 'seed-b')).toBe(true);
    expect(isHeldOutGroup('Q6', 'seed-b')).toBe(true);
    expect(isHeldOutGroup('Q14', 'seed-b')).toBe(false);
  });

  it('holds out about a tenth of the groups', () => {
    let held = 0;
    for (let index = 1; index <= 5000; index += 1) {
      held += isHeldOutGroup(`Q${String(index)}`, 'evaluation-6-seed-a') ? 1 : 0;
    }
    expect(held / 5000).toBeGreaterThan(0.08);
    expect(held / 5000).toBeLessThan(0.125);
  });
});
