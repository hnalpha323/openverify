/**
 * C234.5, C234.6 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 3): a hydrate's field
 * resolution, table by table, then seeded properties: every write lands on a declared field of its
 * type, no destination is written twice, and no key outside the policy's allowlist is written or
 * named.
 */
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../analytics/testing/random.js';
import { SHARE_FIELD_TYPES } from './categories.js';
import {
  resolveHydrateMappings,
  type HydrateDestinationField,
  type HydrateFieldMapping,
  type HydrateMappingInput,
  type HydrateSourceField,
} from './mappings.js';

const source = (
  key: string,
  value: unknown = `synthetic ${key}`,
  type: HydrateSourceField['type'] = 'string',
): HydrateSourceField => ({ key, type, value });

const destination = (
  name: string,
  patch: Partial<HydrateDestinationField> = {},
): HydrateDestinationField => ({
  name,
  type: 'string',
  writeOnce: false,
  filled: false,
  ...patch,
});

const map = (from: string, to: string): HydrateFieldMapping => ({
  'source-field-name': from,
  'destination-field-name': to,
});

const resolve = (patch: Partial<HydrateMappingInput>) =>
  resolveHydrateMappings({
    allowlist: ['name_first', 'name_last', 'birthdate', 'nickname'],
    source: [source('name_first'), source('name_last'), source('birthdate', '1990-01-01')],
    destination: [destination('name_first'), destination('name_last')],
    mappings: [],
    ...patch,
  });

describe('matching by name (C234.5)', () => {
  it('writes every allowlisted field the destination declares with the same type', () => {
    expect(resolve({})).toEqual({
      writes: [
        {
          sourceKey: 'name_first',
          destinationName: 'name_first',
          matchedBy: 'name',
          value: 'synthetic name_first',
        },
        {
          sourceKey: 'name_last',
          destinationName: 'name_last',
          matchedBy: 'name',
          value: 'synthetic name_last',
        },
      ],
      dropped: ['birthdate'],
      failures: [],
    });
  });

  it('drops, by key, a field of another type or a filled write-once field', () => {
    const result = resolve({
      destination: [
        destination('name_first', { type: 'integer' }),
        destination('name_last', { writeOnce: true, filled: true }),
        destination('birthdate', { type: 'string', writeOnce: true, filled: false }),
      ],
    });
    expect(result.writes.map((write) => write.destinationName)).toEqual(['birthdate']);
    expect(result.dropped).toEqual(['name_first', 'name_last']);
    expect(result.failures).toEqual([]);
  });

  it('never writes or names a field outside the allowlist', () => {
    const result = resolve({
      source: [source('name_first'), source('ssn_last4'), source('internal_score')],
      destination: [destination('name_first'), destination('ssn_last4')],
    });
    expect(result.writes.map((write) => write.sourceKey)).toEqual(['name_first']);
    expect(result.dropped).toEqual([]);
  });

  it('writes nothing for, and drops nothing of, a field the source holds no value in', () => {
    const result = resolve({
      // Written out: `source('nickname', undefined)` would take the helper's default value.
      source: [source('name_first', null), { key: 'nickname', type: 'string', value: undefined }],
      destination: [destination('name_first')],
    });
    expect(result).toEqual({ writes: [], dropped: [], failures: [] });
  });
});

describe('field mappings (C234.1, C234.5)', () => {
  it('maps a source field to another name, nested with dots, instead of its name match', () => {
    const result = resolve({
      destination: [destination('name_first'), destination('person.given_name')],
      mappings: [map('name_first', 'person.given_name')],
    });
    expect(result.writes).toEqual([
      {
        sourceKey: 'name_first',
        destinationName: 'person.given_name',
        matchedBy: 'mapping',
        value: 'synthetic name_first',
      },
    ]);
    expect(result.dropped).toEqual(['birthdate', 'name_last']);
  });

  it('maps one source field to two destinations', () => {
    const result = resolve({
      destination: [destination('a'), destination('b')],
      mappings: [map('name_first', 'a'), map('name_first', 'b')],
      source: [source('name_first')],
    });
    expect(result.writes.map((write) => [write.sourceKey, write.destinationName])).toEqual([
      ['name_first', 'a'],
      ['name_first', 'b'],
    ]);
  });

  it('fails a mapping onto an undeclared field, another type, a destination mapped twice, or a filled write-once field', () => {
    const result = resolve({
      source: [
        source('name_first'),
        source('name_last'),
        source('birthdate', '1990-01-01', 'date'),
        source('nickname'),
      ],
      destination: [
        destination('given'),
        destination('dob', { type: 'string' }),
        destination('locked', { writeOnce: true, filled: true }),
      ],
      mappings: [
        map('name_first', 'nowhere'),
        map('birthdate', 'dob'),
        map('name_last', 'given'),
        map('nickname', 'given'),
        map('name_first', 'locked'),
      ],
    });
    expect(result.failures).toEqual([
      { sourceKey: 'name_first', destinationName: 'nowhere', reason: 'destination_not_declared' },
      { sourceKey: 'birthdate', destinationName: 'dob', reason: 'type_mismatch' },
      { sourceKey: 'nickname', destinationName: 'given', reason: 'destination_mapped_twice' },
      { sourceKey: 'name_first', destinationName: 'locked', reason: 'write_once' },
    ]);
    expect(result.writes.map((write) => write.destinationName)).toEqual(['given']);
  });

  it('does not fail a write-once mapping that has nothing to write', () => {
    const result = resolve({
      source: [source('name_first', null)],
      destination: [destination('locked', { writeOnce: true, filled: true })],
      mappings: [map('name_first', 'locked')],
    });
    expect(result).toEqual({ writes: [], dropped: [], failures: [] });
  });

  it('lets a mapping take a destination from the field that matches it by name, which is dropped', () => {
    const result = resolve({
      source: [source('name_first'), source('nickname')],
      destination: [destination('name_first')],
      mappings: [map('nickname', 'name_first')],
    });
    expect(result.writes).toEqual([
      {
        sourceKey: 'nickname',
        destinationName: 'name_first',
        matchedBy: 'mapping',
        value: 'synthetic nickname',
      },
    ]);
    expect(result.dropped).toEqual(['name_first']);
  });

  it('drops, by the key the destination named, a mapping of a field the policy does not share', () => {
    const result = resolve({
      source: [source('name_first'), source('ssn_last4')],
      destination: [destination('tax')],
      mappings: [map('ssn_last4', 'tax'), map('missing_key', 'tax'), map('ssn_last4', 'tax')],
    });
    expect(result.writes).toEqual([]);
    expect(result.failures).toEqual([]);
    // `name_first` is shared but `tax` is all the destination declares, so it is dropped too.
    expect(result.dropped).toEqual(['missing_key', 'name_first', 'ssn_last4']);
  });
});

describe('the invariants of a resolution (property tests, seeded)', () => {
  it('writes declared fields of the same type once each, from allowlisted keys only', () => {
    const random = seededRandom(234_5);
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const names = [...keys, 'x.y', 'z'];
    for (let run = 0; run < 2000; run += 1) {
      const allowlist = keys.filter(() => random.chance(0.6));
      const input: HydrateMappingInput = {
        allowlist,
        source: keys
          .filter(() => random.chance(0.8))
          .map((key) => ({
            key,
            type: random.pick(SHARE_FIELD_TYPES),
            value: random.chance(0.8) ? 'v' : null,
          })),
        destination: names
          .filter(() => random.chance(0.7))
          .map((name) => ({
            name,
            type: random.pick(SHARE_FIELD_TYPES),
            writeOnce: random.chance(0.3),
            filled: random.chance(0.5),
          })),
        mappings: Array.from({ length: random.int(0, 4) }, () =>
          map(random.pick([...keys, 'q']), random.pick(names)),
        ),
      };
      const result = resolveHydrateMappings(input);
      const label = `run ${String(run)}`;
      const declared = new Map(input.destination.map((entry) => [entry.name, entry]));
      const sourceType = new Map(input.source.map((entry) => [entry.key, entry.type]));
      const written = result.writes.map((write) => write.destinationName);
      expect(new Set(written).size, label).toBe(written.length);
      for (const write of result.writes) {
        expect(allowlist, label).toContain(write.sourceKey);
        expect(declared.get(write.destinationName)?.type, label).toBe(
          sourceType.get(write.sourceKey),
        );
        expect(
          declared.get(write.destinationName)?.writeOnce &&
            declared.get(write.destinationName)?.filled,
          label,
        ).toBe(false);
        expect(write.value, label).not.toBeNull();
      }
      const named = new Set(input.mappings.map((mapping) => mapping['source-field-name']));
      for (const key of result.dropped) {
        expect(allowlist.includes(key) || named.has(key), label).toBe(true);
      }
      expect([...result.dropped].sort(), label).toEqual([...new Set(result.dropped)]);
    }
  });
});
