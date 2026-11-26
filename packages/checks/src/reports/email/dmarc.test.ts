/**
 * C82.1: `email-dmarc-policy` through the RFC 9989 §4.10 DNS tree walk (at most eight queries, no
 * public-suffix list); informational only.
 */
import { describe, expect, it } from 'vitest';
import {
  dmarcQueryNames,
  dmarcRecordOf,
  parseDmarcRecord,
  walkDmarc,
  type DmarcLookup,
} from './dmarc.js';

describe('parseDmarcRecord', () => {
  it('reads p alone, with every other tag at its absence', () => {
    expect(parseDmarcRecord('v=DMARC1; p=reject')).toEqual({
      p: 'reject',
      sp: null,
      np: null,
      testing: false,
      psd: 'u',
      validRua: false,
    });
  });

  it('reads every tag the policy needs', () => {
    expect(
      parseDmarcRecord(
        'v=DMARC1;p=quarantine;sp=none;np=reject;t=y;psd=n;rua=mailto:dmarc@example.org',
      ),
    ).toEqual({
      p: 'quarantine',
      sp: 'none',
      np: 'reject',
      testing: true,
      psd: 'n',
      validRua: true,
    });
  });

  it('allows spaces around tags and reads policy values in any case', () => {
    expect(parseDmarcRecord(' v = DMARC1 ; p = Reject ; ')?.p).toBe('reject');
  });

  it.each(['v=dmarc1; p=reject', 'p=reject; v=DMARC1', 'v=DMARC10; p=reject', 'v=spf1 -all', ''])(
    'is no DMARC record without a leading v=DMARC1 (%j)',
    (text) => {
      expect(parseDmarcRecord(text)).toBeNull();
    },
  );

  it('marks a policy value it does not know as invalid, and ignores unknown tags', () => {
    expect(parseDmarcRecord('v=DMARC1; p=bogus; sp=; np=strict; x=1')).toEqual({
      p: 'invalid',
      sp: 'invalid',
      np: 'invalid',
      testing: false,
      psd: 'u',
      validRua: false,
    });
    expect(parseDmarcRecord('v=DMARC1')?.p).toBeNull();
  });

  it('reads rua as valid only when it holds a URI, and psd and t only at y or n', () => {
    expect(parseDmarcRecord('v=DMARC1; p=none; rua=')?.validRua).toBe(false);
    expect(parseDmarcRecord('v=DMARC1; p=none; rua=dmarc@example.org')?.validRua).toBe(false);
    expect(
      parseDmarcRecord('v=DMARC1; p=none; rua=mailto:a@example.org,https://example.org/r')
        ?.validRua,
    ).toBe(true);
    expect(parseDmarcRecord('v=DMARC1; p=none; psd=x')?.psd).toBe('u');
    expect(parseDmarcRecord('v=DMARC1; p=none; t=n')?.testing).toBe(false);
  });
});

describe('dmarcRecordOf', () => {
  it('takes the one DMARC record of an answer, its strings concatenated', () => {
    expect(dmarcRecordOf([])).toBeNull();
    expect(dmarcRecordOf([['v=spf1 -all']])).toBeNull();
    expect(dmarcRecordOf([['v=spf1 -all'], ['v=DMARC1; ', 'p=reject']])?.p).toBe('reject');
  });

  it('discards every DMARC record when there are two', () => {
    expect(dmarcRecordOf([['v=DMARC1; p=reject'], ['v=DMARC1; p=none']])).toBeNull();
  });
});

describe('dmarcQueryNames', () => {
  it('asks the Author Domain, then each parent down to the top-level label', () => {
    expect(dmarcQueryNames('mail.example.com')).toEqual([
      '_dmarc.mail.example.com',
      '_dmarc.example.com',
      '_dmarc.com',
    ]);
    expect(dmarcQueryNames('example.com')).toEqual(['_dmarc.example.com', '_dmarc.com']);
  });

  it('asks at most eight names, starting the walk at seven labels (the RFC 9989 example)', () => {
    expect(dmarcQueryNames('a.b.c.d.e.f.g.h.i.j.mail.example.com')).toEqual([
      '_dmarc.a.b.c.d.e.f.g.h.i.j.mail.example.com',
      '_dmarc.g.h.i.j.mail.example.com',
      '_dmarc.h.i.j.mail.example.com',
      '_dmarc.i.j.mail.example.com',
      '_dmarc.j.mail.example.com',
      '_dmarc.mail.example.com',
      '_dmarc.example.com',
      '_dmarc.com',
    ]);
    expect(dmarcQueryNames('a.b.c.d.e.f.g.com')).toHaveLength(8);
    expect(dmarcQueryNames('a.b.c.d.e.f.g.com')[1]).toBe('_dmarc.b.c.d.e.f.g.com');
    expect(dmarcQueryNames('b.c.d.e.f.g.com')).toHaveLength(7);
  });
});

/** A lookup over fixed answers, recording each name asked. */
function zone(records: Readonly<Record<string, string | readonly string[]>>, failing?: string) {
  const asked: string[] = [];
  const lookup = (name: string): Promise<DmarcLookup> => {
    asked.push(name);
    if (name === failing) {
      return Promise.resolve({ kind: 'error' });
    }
    const found = records[name];
    if (found === undefined) {
      return Promise.resolve({ kind: 'none' });
    }
    const texts = typeof found === 'string' ? [found] : found;
    return Promise.resolve({ kind: 'records', records: texts.map((text) => [text]) });
  };
  return { asked, lookup };
}

describe('walkDmarc', () => {
  it('takes p from a record at the Author Domain, asking nothing else', async () => {
    const { asked, lookup } = zone({ '_dmarc.example.com': 'v=DMARC1; p=reject' });

    expect(await walkDmarc('example.com', lookup, true)).toEqual({
      kind: 'reading',
      reading: { policy: 'reject', testing: false, foundAt: 'author_domain', queries: 1 },
    });
    expect(asked).toEqual(['_dmarc.example.com']);
  });

  it('walks to the top without a psd tag, and takes sp from the Organizational Domain', async () => {
    const { asked, lookup } = zone({
      '_dmarc.example.com': 'v=DMARC1; p=quarantine; sp=none',
    });

    expect(await walkDmarc('mail.example.com', lookup, true)).toEqual({
      kind: 'reading',
      reading: { policy: 'none', testing: false, foundAt: 'organizational_domain', queries: 3 },
    });
    expect(asked).toEqual(['_dmarc.mail.example.com', '_dmarc.example.com', '_dmarc.com']);
  });

  it('takes np for an Author Domain that does not exist, falling back to sp, then p', async () => {
    const withNp = zone({ '_dmarc.example.com': 'v=DMARC1; p=none; sp=quarantine; np=reject' });
    const withoutNp = zone({ '_dmarc.example.com': 'v=DMARC1; p=none; sp=quarantine' });
    const pOnly = zone({ '_dmarc.example.com': 'v=DMARC1; p=reject' });

    const policy = async (outcome: ReturnType<typeof walkDmarc>) => {
      const result = await outcome;
      return result.kind === 'reading' ? result.reading.policy : result.kind;
    };
    expect(await policy(walkDmarc('gone.example.com', withNp.lookup, false))).toBe('reject');
    expect(await policy(walkDmarc('gone.example.com', withoutNp.lookup, false))).toBe('quarantine');
    expect(await policy(walkDmarc('gone.example.com', pOnly.lookup, false))).toBe('reject');
    expect(await policy(walkDmarc('mail.example.com', pOnly.lookup, true))).toBe('reject');
  });

  it('cannot choose between sp and np without knowing whether the Author Domain exists', async () => {
    const differing = zone({ '_dmarc.example.com': 'v=DMARC1; p=none; np=reject' });
    const agreeing = zone({ '_dmarc.example.com': 'v=DMARC1; p=reject' });

    expect(await walkDmarc('mail.example.com', differing.lookup, null)).toEqual({
      kind: 'undetermined',
      queries: 3,
    });
    expect(await walkDmarc('mail.example.com', agreeing.lookup, null)).toEqual({
      kind: 'reading',
      reading: { policy: 'reject', testing: false, foundAt: 'organizational_domain', queries: 3 },
    });
  });

  it('stops at psd=n, which names the Organizational Domain', async () => {
    const { asked, lookup } = zone({
      '_dmarc.mail.example.com': 'v=DMARC1; psd=n; p=reject',
      '_dmarc.example.com': 'v=DMARC1; p=none',
    });

    expect(await walkDmarc('a.mail.example.com', lookup, true)).toEqual({
      kind: 'reading',
      reading: { policy: 'reject', testing: false, foundAt: 'organizational_domain', queries: 2 },
    });
    expect(asked).toEqual(['_dmarc.a.mail.example.com', '_dmarc.mail.example.com']);
  });

  it('reads the Organizational Domain one label below a psd=y record', async () => {
    const { lookup } = zone({
      '_dmarc.example.com': 'v=DMARC1; p=reject',
      '_dmarc.com': 'v=DMARC1; psd=y; p=quarantine',
    });

    expect(await walkDmarc('shop.example.com', lookup, true)).toEqual({
      kind: 'reading',
      reading: { policy: 'reject', testing: false, foundAt: 'organizational_domain', queries: 3 },
    });
  });

  it('applies the PSD’s record when the Organizational Domain publishes none', async () => {
    const { lookup } = zone({ '_dmarc.com': 'v=DMARC1; psd=y; p=quarantine' });

    expect(await walkDmarc('shop.example.com', lookup, true)).toEqual({
      kind: 'reading',
      reading: {
        policy: 'quarantine',
        testing: false,
        foundAt: 'public_suffix_domain',
        queries: 3,
      },
    });
  });

  it('reads the Organizational Domain from the record with the fewest labels', async () => {
    const { lookup } = zone({
      '_dmarc.b.example.com': 'v=DMARC1; p=reject',
      '_dmarc.example.com': 'v=DMARC1; p=none',
    });

    const outcome = await walkDmarc('a.b.example.com', lookup, true);
    expect(outcome).toEqual({
      kind: 'reading',
      reading: { policy: 'none', testing: false, foundAt: 'organizational_domain', queries: 4 },
    });
  });

  it('reads no record when the walk finds none, two records at a name counting as none', async () => {
    const { lookup } = zone({
      '_dmarc.example.com': ['v=DMARC1; p=reject', 'v=DMARC1; p=none'],
    });

    expect(await walkDmarc('mail.example.com', lookup, true)).toEqual({
      kind: 'reading',
      reading: { policy: 'no_record', testing: false, foundAt: null, queries: 3 },
    });
  });

  it('reads an invalid policy as none beside a valid rua, and as invalid without one', async () => {
    const withRua = zone({ '_dmarc.example.com': 'v=DMARC1; p=bogus; rua=mailto:r@example.org' });
    const withoutRua = zone({ '_dmarc.example.com': 'v=DMARC1; p=bogus' });
    const badSp = zone({ '_dmarc.example.com': 'v=DMARC1; p=reject; sp=bogus' });
    const missingP = zone({ '_dmarc.example.com': 'v=DMARC1; rua=mailto:r@example.org' });

    const policy = async (outcome: ReturnType<typeof walkDmarc>) => {
      const result = await outcome;
      return result.kind === 'reading' ? result.reading.policy : result.kind;
    };
    expect(await policy(walkDmarc('example.com', withRua.lookup, true))).toBe('none');
    expect(await policy(walkDmarc('example.com', withoutRua.lookup, true))).toBe('invalid');
    expect(await policy(walkDmarc('mail.example.com', badSp.lookup, true))).toBe('invalid');
    expect(await policy(walkDmarc('example.com', missingP.lookup, true))).toBe('none');
  });

  it('flags testing only on a quarantine or reject policy with t=y', async () => {
    const reject = zone({ '_dmarc.example.com': 'v=DMARC1; p=reject; t=y' });
    const none = zone({ '_dmarc.example.com': 'v=DMARC1; p=none; t=y' });

    const testing = async (outcome: ReturnType<typeof walkDmarc>) => {
      const result = await outcome;
      return result.kind === 'reading' && result.reading.testing;
    };
    expect(await testing(walkDmarc('example.com', reject.lookup, true))).toBe(true);
    expect(await testing(walkDmarc('example.com', none.lookup, true))).toBe(false);
  });

  it('stops at the first lookup that fails: the policy is then unknown', async () => {
    const atAuthor = zone({}, '_dmarc.example.com');
    const midWalk = zone({}, '_dmarc.example.com');

    expect(await walkDmarc('example.com', atAuthor.lookup, true)).toEqual({
      kind: 'error',
      queries: 1,
    });
    expect(await walkDmarc('mail.example.com', midWalk.lookup, true)).toEqual({
      kind: 'error',
      queries: 2,
    });
    expect(midWalk.asked).toEqual(['_dmarc.mail.example.com', '_dmarc.example.com']);
  });

  it('never asks more than eight names', async () => {
    const { asked, lookup } = zone({});

    const outcome = await walkDmarc('a.b.c.d.e.f.g.h.i.j.mail.example.com', lookup, true);
    expect(outcome).toEqual({
      kind: 'reading',
      reading: { policy: 'no_record', testing: false, foundAt: null, queries: 8 },
    });
    expect(asked).toHaveLength(8);
  });
});
