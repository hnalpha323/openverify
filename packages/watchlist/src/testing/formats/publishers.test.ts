import { inflateRawSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../../record/index.js';
import { syntheticWatchlist } from '../records.js';
import { euFsfXml, EU_FSF_NAMESPACE } from './eu.js';
import {
  OFAC_ENHANCED_NAMESPACE,
  OFAC_LIST_NAMES,
  ofacEnhancedXml,
  ofacSdnEnhancedZip,
} from './ofac.js';
import { ukSanctionsListXml } from './uk.js';
import { unConsolidatedXml } from './un.js';

interface Node {
  name: string;
  attributes: Record<string, string>;
  children: Node[];
  text: string;
}

/** Parses a document strictly (no DOCTYPE allowed) into a small tree. */
function parse(xml: string): Node {
  expect(xml).not.toContain('<!DOCTYPE');
  const root: Node = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [root];
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) => {
    const node: Node = {
      name: tag.name,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).map(([key, value]) => [key, value]),
      ),
      children: [],
      text: '',
    };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  });
  parser.on('text', (text) => {
    const top = stack.at(-1);
    if (top !== undefined) {
      top.text += text;
    }
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  const [document] = root.children;
  if (document === undefined) {
    throw new Error('no root element');
  }
  return document;
}

const all = (node: Node, name: string): Node[] => [
  ...node.children.filter((child) => child.name === name),
  ...node.children.flatMap((child) => all(child, name)),
];
const texts = (node: Node, name: string): string[] =>
  all(node, name).map((found) => found.text.trim());

const RECORDS = syntheticWatchlist({ seed: 'publishers', idStyle: 'ofac' });
const individuals = RECORDS.filter((record) => record.kind === 'individual');
const primaryOf = (record: WatchlistRecord) => record.names.find((name) => name.primary);
function must<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('missing');
  }
  return value;
}

describe('OFAC enhanced XML', () => {
  const xml = ofacEnhancedXml(RECORDS, { dataAsOf: '2026-01-05T00:00:00-05:00' });
  const root = parse(xml);

  it('writes the namespace, the publication time and one entity per record', () => {
    expect(root.name).toBe('sanctionsData');
    expect(root.attributes.xmlns).toBe(OFAC_ENHANCED_NAMESPACE);
    expect(texts(root, 'dataAsOf')).toEqual(['2026-01-05T00:00:00-05:00']);
    const entities = all(root, 'entity');
    expect(entities.map((entity) => entity.attributes.id)).toEqual(RECORDS.map((r) => r.entry_id));
    expect(entities.map((entity) => texts(entity, 'entityType')[0])).toEqual(
      RECORDS.map(
        (record) =>
          ({ individual: 'Individual', entity: 'Entity', vessel: 'Vessel', aircraft: 'Aircraft' })[
            record.kind
          ],
      ),
    );
    expect(texts(root, 'sanctionsList')).toContain('SDN List');
    expect(xml).toBe(ofacEnhancedXml(RECORDS, { dataAsOf: '2026-01-05T00:00:00-05:00' }));
  });

  it('writes names with their quality, parts and original-script translations', () => {
    const first = all(root, 'entity')[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    const names = all(first, 'name');
    expect(texts(names[0] ?? first, 'isPrimary')[0]).toBe('true');
    expect(names.some((name) => texts(name, 'isLowQuality')[0] === 'true')).toBe(true);
    expect(texts(first, 'script')).toEqual(expect.arrayContaining(['Latin', 'Cyrillic']));
    const parts = all(first, 'namePart').map((part) => texts(part, 'type')[0]);
    expect(parts).toEqual(expect.arrayContaining(['First Name', 'Last Name', 'Middle Name']));
    const family = primaryOf(must(individuals[0]))?.parts.find((p) => p.role === 'family');
    expect(texts(first, 'value')).toContain(family?.value);
  });

  it('writes dated features, documents and digital currency addresses', () => {
    const types = texts(root, 'type');
    expect(types).toEqual(expect.arrayContaining(['Birthdate', 'Passport', 'Legal Entity Number']));
    expect(types).toContain('Digital Currency Address - USDT');
    expect(all(root, 'valueDate').length).toBeGreaterThan(0);
    expect(texts(root, 'isApproximate')).toContain('true');
    const raws = RECORDS.flatMap((record) => record.crypto_addresses.map(({ raw }) => raw));
    for (const raw of raws) {
      expect(texts(root, 'value')).toContain(raw);
    }
    const imo = RECORDS.flatMap((r) => r.identifiers).find(
      (identifier) => identifier.kind === 'imo',
    );
    expect(texts(root, 'documentNumber')).toContain(`IMO ${imo?.value ?? ''}`);
  });

  it('states countries through country reference values, by refId, as the XSD does', () => {
    const references = new Map(
      all(root, 'referenceValue')
        .filter((value) => texts(value, 'type')[0] === 'Country')
        .map((value) => [value.attributes.refId, texts(value, 'isoCode')[0]] as const),
    );
    expect(references.size).toBeGreaterThan(0);
    const issuers = all(root, 'issuingCountry');
    expect(issuers.length).toBeGreaterThan(0);
    for (const issuer of issuers) {
      expect(references.get(issuer.attributes.refId)).toMatch(/^[A-Z]{2}$/);
    }
    for (const country of all(root, 'address').flatMap((address) => all(address, 'country'))) {
      expect(references.has(country.attributes.refId)).toBe(true);
    }
    const nationality = all(root, 'feature').filter(
      (feature) => texts(feature, 'type')[0] === 'Nationality Country',
    );
    expect(nationality.length).toBeGreaterThan(0);
    for (const feature of nationality) {
      expect(references.has(texts(feature, 'valueRefId')[0])).toBe(true);
    }
  });

  it('writes a record’s list memberships as its lists, beside the SDN List on the SDN file (owner decision 9 after 6B)', () => {
    const [first, second] = RECORDS;
    const listed: WatchlistRecord[] = [
      {
        ...must(first),
        list_memberships: [
          { list: OFAC_LIST_NAMES.consolidated, program: null },
          { list: 'Non-SDN Menu-Based Sanctions List', program: null },
        ],
      },
      must(second),
    ];
    const listsOf = (xml: string) =>
      all(parse(xml), 'entity').map((entity) =>
        all(entity, 'sanctionsLists').flatMap((lists) => texts(lists, 'sanctionsList')),
      );
    const options = { dataAsOf: '2026-01-05T00:00:00-05:00' } as const;

    expect(listsOf(ofacEnhancedXml(listed, { ...options, list: 'consolidated' }))).toEqual([
      [OFAC_LIST_NAMES.consolidated, 'Non-SDN Menu-Based Sanctions List'],
      [OFAC_LIST_NAMES.consolidated],
    ]);
    expect(listsOf(ofacEnhancedXml(listed, options))).toEqual([
      [OFAC_LIST_NAMES.sdn, OFAC_LIST_NAMES.consolidated, 'Non-SDN Menu-Based Sanctions List'],
      [OFAC_LIST_NAMES.sdn],
    ]);
  });

  it('writes the Consolidated list under its own list name, and the SDN list as a ZIP member', () => {
    const consolidated = parse(
      ofacEnhancedXml(RECORDS, { dataAsOf: '2026-01-05T00:00:00-05:00', list: 'consolidated' }),
    );
    expect(texts(consolidated, 'sanctionsList')).not.toContain('SDN List');
    const archive = Buffer.from(
      ofacSdnEnhancedZip(RECORDS, { dataAsOf: '2026-01-05T00:00:00-05:00' }),
    );
    expect(archive.toString('utf8', 30, 30 + 'SDN_ENHANCED.XML'.length)).toBe('SDN_ENHANCED.XML');
    const start = 30 + archive.readUInt16LE(26) + archive.readUInt16LE(28);
    const inflated = inflateRawSync(archive.subarray(start, start + archive.readUInt32LE(18)));
    expect(inflated.toString('utf8')).toBe(xml);
  });
});

describe('EU FSF XML 1.1', () => {
  const RECORDS_EU = syntheticWatchlist({ seed: 'publishers', idStyle: 'eu' });
  const root = parse(
    euFsfXml(RECORDS_EU, { generationDate: '2026-01-05T12:00:00.000+01:00', globalFileId: 900001 }),
  );

  it('writes the export root and one sanction entity per record', () => {
    expect(root.name).toBe('export');
    expect(root.attributes).toMatchObject({
      xmlns: EU_FSF_NAMESPACE,
      generationDate: '2026-01-05T12:00:00.000+01:00',
      globalFileId: '900001',
    });
    const entities = all(root, 'sanctionEntity');
    expect(entities.map((entity) => entity.attributes.logicalId)).toEqual(
      RECORDS_EU.map((record) => record.entry_id),
    );
    expect(entities.map((entity) => all(entity, 'subjectType')[0]?.attributes.code)).toEqual(
      RECORDS_EU.map((record) => (record.kind === 'individual' ? 'person' : 'enterprise')),
    );
  });

  it('writes alias strength, partial and circa birth dates, citizenship and documents', () => {
    const aliases = all(root, 'nameAlias');
    expect(aliases.some((alias) => alias.attributes.strong === 'false')).toBe(true);
    expect(aliases[0]?.attributes.wholeName).toBe(primaryOf(must(RECORDS_EU[0]))?.full);
    const dates = all(root, 'birthdate');
    expect(
      dates.some(
        (date) => date.attributes.birthdate !== undefined && date.attributes.birthdate !== '',
      ),
    ).toBe(true);
    expect(dates.some((date) => date.attributes.circa === 'true')).toBe(true);
    expect(
      dates.some((date) => date.attributes.dayOfMonth === '' && date.attributes.year !== ''),
    ).toBe(true);
    expect(
      all(root, 'citizenship').every((c) => /^[A-Z]{2}$/.test(c.attributes.countryIso2Code ?? '')),
    ).toBe(true);
    expect(all(root, 'identification').map((id) => id.attributes.identificationTypeCode)).toContain(
      'passport',
    );
  });
});

describe('UK Sanctions List XML', () => {
  const RECORDS_UK = syntheticWatchlist({ seed: 'publishers', idStyle: 'uk' });
  const root = parse(ukSanctionsListXml(RECORDS_UK, { dateGenerated: '2026-01-05' }));

  it('writes the generation date and one designation per record', () => {
    expect(root.name).toBe('Designations');
    expect(texts(root, 'DateGenerated')).toEqual(['05/01/2026']);
    expect(texts(root, 'UniqueID')).toEqual(RECORDS_UK.map((record) => record.entry_id));
    expect(texts(root, 'IndividualEntityShip')).toEqual(
      RECORDS_UK.map(
        (record) =>
          ({ individual: 'Individual', entity: 'Entity', vessel: 'Ship', aircraft: 'Entity' })[
            record.kind
          ],
      ),
    );
  });

  it('writes Name1 to Name6, alias strength, non-Latin names, dates, ships and wallets', () => {
    const family = primaryOf(must(RECORDS_UK[0]))?.parts.find((part) => part.role === 'family');
    expect(texts(root, 'Name6')).toContain(family?.value);
    expect(texts(root, 'AliasStrength')).toContain('Low');
    expect(texts(root, 'NonLatinScriptType')).toEqual(expect.arrayContaining(['Cyrillic']));
    expect(texts(root, 'DOB').some((dob) => dob.startsWith('dd/mm/'))).toBe(true);
    expect(texts(root, 'IMONumber').length).toBeGreaterThan(0);
    const wallets = RECORDS_UK.flatMap((record) => record.crypto_addresses.map(({ raw }) => raw));
    expect(texts(root, 'CryptoWalletAddress')).toEqual(wallets);
  });
});

describe('UN consolidated XML', () => {
  const RECORDS_UN = syntheticWatchlist({ seed: 'publishers', idStyle: 'un' });
  const root = parse(unConsolidatedXml(RECORDS_UN, { dateGenerated: '2026-01-05T23:00:00.000Z' }));

  it('writes individuals and entities with their references', () => {
    expect(root.name).toBe('CONSOLIDATED_LIST');
    expect(root.attributes.dateGenerated).toBe('2026-01-05T23:00:00.000Z');
    const people = all(root, 'INDIVIDUAL');
    expect(people).toHaveLength(RECORDS_UN.filter((r) => r.kind === 'individual').length);
    expect(all(root, 'ENTITY')).toHaveLength(
      RECORDS_UN.filter((r) => r.kind !== 'individual').length,
    );
    expect(texts(root, 'REFERENCE_NUMBER').sort()).toEqual(
      RECORDS_UN.map((r) => r.entry_id).sort(),
    );
    expect(new Set(texts(root, 'DATAID')).size).toBe(RECORDS_UN.length);
  });

  it('writes alias qualities, date types, original scripts and documents', () => {
    expect(texts(root, 'QUALITY')).toEqual(expect.arrayContaining(['Good', 'Low']));
    expect(texts(root, 'TYPE_OF_DATE')).toEqual(expect.arrayContaining(['EXACT', 'APPROXIMATELY']));
    expect(texts(root, 'NAME_ORIGINAL_SCRIPT').length).toBeGreaterThan(0);
    expect(texts(root, 'TYPE_OF_DOCUMENT')).toContain('Passport');
    expect(texts(root, 'NATIONALITY').length).toBeGreaterThan(0);
  });
});
