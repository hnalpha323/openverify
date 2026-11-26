/**
 * Owner decision 9 after 6B: the evidence members a snapshot's entity takes from its record. The
 * lists and programmes are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { recordEvidence } from './record-evidence.js';

describe('recordEvidence (owner decision 9)', () => {
  it('names an entry’s lists other than the SDN List, each with its programme or null', () => {
    expect(
      recordEvidence({
        list_memberships: [
          { list: 'Synthetic Sectoral List', program: 'SYNTHETIC-SECTORAL' },
          { list: 'Synthetic Non-Blocking List', program: null },
        ],
      }),
    ).toEqual({
      'list-memberships': [
        { list: 'Synthetic Sectoral List', program: 'SYNTHETIC-SECTORAL' },
        { list: 'Synthetic Non-Blocking List', program: null },
      ],
    });
  });

  it('states a relative’s PEP class', () => {
    expect(recordEvidence({ relative_of_class: 2 })).toEqual({ 'relative-of-class': 2 });
  });

  it('adds nothing for a record without them, so earlier snapshots keep their shape', () => {
    expect(recordEvidence({})).toEqual({});
  });

  it('copies the memberships, so the snapshot never shares the record’s array', () => {
    const memberships = [{ list: 'Synthetic Sectoral List', program: null }];
    const evidence = recordEvidence({ list_memberships: memberships });
    expect(evidence['list-memberships']).not.toBe(memberships);
    expect(evidence['list-memberships']?.[0]).not.toBe(memberships[0]);
  });
});
