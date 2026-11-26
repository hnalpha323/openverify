/** C78.3 (owner decision 1 after 6B): what retrieval is given for a subject. Fictional names. */
import { describe, expect, it } from 'vitest';
import { queryNameKeys, queryNameReach, variantGroupsFrom } from '../keys/index.js';
import { retrievalQuery } from './retrieval.js';
import { personSubject } from './subject.js';

const groups = variantGroupsFrom([['Q10', ['orlan', 'orlen']]], 'a'.repeat(64));

describe('retrievalQuery', () => {
  it('gives the keys, the reach of every name, the identifiers and the normalised names', () => {
    const subject = personSubject({
      term: 'Orlan Vexby',
      'additional-names': [{ term: 'Talia Morrow Quist' }],
      'identification-number': 'SP1234567',
      'identification-type': 'passport',
    });
    const query = retrievalQuery(subject, groups);
    expect(query.keys).toEqual(queryNameKeys(subject.names, groups));
    expect(query.reach).toEqual(queryNameReach(subject.names, groups));
    expect(query.reach).toHaveLength(4);
    expect(query.reach.flat().every((key) => query.keys.includes(key))).toBe(true);
    expect(query.identifiers).toEqual([{ kind: 'passport', value: 'SP1234567' }]);
    expect(query.normalisedNames).toEqual(subject.names.map((name) => name.normalised));
    expect(query.normalisedNames).toHaveLength(2);
  });
});
