/**
 * C80.2-C80.4: the PEP rules on a frozen clock, one test per case, over fictional `Q-test`
 * holders.
 */
import { describe, expect, it } from 'vitest';
import {
  partialDateBounds,
  PEP_RULE_DEFAULTS,
  relativeMayBeSynced,
  tenureOf,
  tenureRetained,
  type TenureStatement,
} from './rules.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const OPTIONS = { now: NOW };

const held = (overrides: Partial<TenureStatement> = {}): TenureStatement => ({
  person: 'Q-test-1001',
  start: '2022-05-01',
  end: null,
  endStated: false,
  successor: null,
  ...overrides,
});

describe('PEP_RULE_DEFAULTS', () => {
  it('fixes the plan values, each provisional with a source', () => {
    expect(PEP_RULE_DEFAULTS.openTenureMaxYears.value).toBe(20);
    expect(PEP_RULE_DEFAULTS.retentionMonths.value).toBe(12);
    expect(PEP_RULE_DEFAULTS.headRetentionMonths.value).toBe(60);
    expect(PEP_RULE_DEFAULTS.relativeMinimumAgeYears.value).toBe(18);
    for (const entry of Object.values(PEP_RULE_DEFAULTS)) {
      expect(entry.basis).toBe('provisional');
      expect(entry.source).toMatch(/^C80\.\d/u);
    }
  });
});

describe('partialDateBounds', () => {
  it('spans a day, a month or a year in UTC', () => {
    expect(partialDateBounds('2024-02-29')).toEqual({
      earliest: Date.parse('2024-02-29T00:00:00.000Z'),
      latest: Date.parse('2024-02-29T23:59:59.999Z'),
    });
    expect(partialDateBounds('2024-02')).toEqual({
      earliest: Date.parse('2024-02-01T00:00:00.000Z'),
      latest: Date.parse('2024-02-29T23:59:59.999Z'),
    });
    expect(partialDateBounds('2023')).toEqual({
      earliest: Date.parse('2023-01-01T00:00:00.000Z'),
      latest: Date.parse('2023-12-31T23:59:59.999Z'),
    });
  });
});

describe('tenureOf (C80.2)', () => {
  it('reads a stated end: in office until it passes', () => {
    expect(tenureOf(held({ end: '2025-01-31' }), [], false, OPTIONS)).toEqual({
      start: '2022-05-01',
      end: '2025-01-31',
      in_office: 'no',
    });
    expect(tenureOf(held({ end: '2027-05' }), [], false, OPTIONS)).toMatchObject({
      end: '2027-05',
      in_office: 'yes',
    });
  });

  it('reads an end stated without a usable value as ended at an unknown date', () => {
    expect(tenureOf(held({ endStated: true }), [], false, OPTIONS)).toEqual({
      start: '2022-05-01',
      end: 'unknown',
      in_office: 'no',
    });
  });

  it('reads a start still to come as an incoming holder', () => {
    expect(tenureOf(held({ start: '2027-01-15' }), [], false, OPTIONS)).toEqual({
      start: '2027-01-15',
      end: null,
      in_office: 'unknown',
    });
  });

  it('counts an open tenure as current without a successor or later holder, within the limit', () => {
    const statement = held();
    expect(tenureOf(statement, [statement], true, OPTIONS)).toEqual({
      start: '2022-05-01',
      end: null,
      in_office: 'yes',
    });
    expect(tenureOf(held({ start: '2006' }), [], false, OPTIONS).in_office).toBe('yes');
  });

  it('ends an open tenure that started before the limit, at an unknown date', () => {
    expect(tenureOf(held({ start: '2005-06-01' }), [], false, OPTIONS)).toEqual({
      start: '2005-06-01',
      end: 'unknown',
      in_office: 'no',
    });
    expect(tenureOf(held({ start: '2005' }), [], false, OPTIONS).in_office).toBe('no');
    expect(
      tenureOf(held({ start: '2005-06-01' }), [], false, { ...OPTIONS, openTenureMaxYears: 30 })
        .in_office,
    ).toBe('yes');
  });

  it('ends an open tenure without a start at an unknown date', () => {
    expect(tenureOf(held({ start: null }), [], false, OPTIONS)).toEqual({
      start: null,
      end: 'unknown',
      in_office: 'no',
    });
  });

  it('ends an open tenure with a successor at the successor’s start, else at an unknown date', () => {
    const predecessor = held({ start: '2015-01-10', successor: 'Q-test-1002' });
    const successor = held({ person: 'Q-test-1002', start: '2019-07-24' });
    const other = held({ person: 'Q-test-1003', start: '2018-01-01' });
    expect(tenureOf(predecessor, [predecessor, other, successor], false, OPTIONS)).toEqual({
      start: '2015-01-10',
      end: '2019-07-24',
      in_office: 'no',
    });
    expect(tenureOf(predecessor, [predecessor], false, OPTIONS).end).toBe('unknown');
    expect(tenureOf(held({ successor: 'unknown' }), [], false, OPTIONS)).toMatchObject({
      end: 'unknown',
      in_office: 'no',
    });
  });

  it('ends an open tenure of a single-holder position at a later holder’s start', () => {
    const earlier = held({ start: '2016-03-01' });
    const later = held({ person: 'Q-test-1002', start: '2021-03-01', end: '2024-03-01' });
    const vague = held({ person: 'Q-test-1003', start: '2016' });
    expect(tenureOf(earlier, [earlier, vague, later], true, OPTIONS)).toEqual({
      start: '2016-03-01',
      end: '2021-03-01',
      in_office: 'no',
    });
    expect(tenureOf(earlier, [earlier, vague, later], false, OPTIONS).in_office).toBe('yes');
    expect(tenureOf(earlier, [earlier, vague], true, OPTIONS).in_office).toBe('yes');
  });
});

describe('tenureRetained (C80.4)', () => {
  it('keeps a current or incoming tenure', () => {
    expect(tenureRetained({ start: null, end: null, in_office: 'yes' }, false, OPTIONS)).toBe(true);
    expect(tenureRetained({ start: '2027', end: null, in_office: 'unknown' }, false, OPTIONS)).toBe(
      true,
    );
  });

  it('keeps a tenure for 12 months after it ended, five years for a head', () => {
    const ended = (end: string) => ({ start: '2010', end, in_office: 'no' as const });
    expect(tenureRetained(ended('2026-04-01'), false, OPTIONS)).toBe(true);
    expect(tenureRetained(ended('2025-10-28'), false, OPTIONS)).toBe(true);
    expect(tenureRetained(ended('2025-10-26'), false, OPTIONS)).toBe(false);
    expect(tenureRetained(ended('2025'), false, OPTIONS)).toBe(true);
    expect(tenureRetained(ended('2022-01-01'), true, OPTIONS)).toBe(true);
    expect(tenureRetained(ended('2021-10-26'), true, OPTIONS)).toBe(false);
    expect(tenureRetained(ended('2026-01-01'), false, { ...OPTIONS, retentionMonths: 6 })).toBe(
      false,
    );
  });

  it('counts an unknown end as older than either retention', () => {
    expect(tenureRetained({ start: '2025', end: 'unknown', in_office: 'no' }, true, OPTIONS)).toBe(
      false,
    );
  });
});

describe('relativeMayBeSynced (C80.3)', () => {
  it('syncs a relative 18 or older on every reading of a stated birth date', () => {
    expect(relativeMayBeSynced(['1990-01-01'], OPTIONS)).toBe(true);
    expect(relativeMayBeSynced(['2008-10-27'], OPTIONS)).toBe(true);
  });

  it('never syncs a possible minor or a relative without a birth date', () => {
    expect(relativeMayBeSynced(['2010-05-05'], OPTIONS)).toBe(false);
    expect(relativeMayBeSynced(['2008-10-28'], OPTIONS)).toBe(false);
    expect(relativeMayBeSynced(['2008'], OPTIONS)).toBe(false);
    expect(relativeMayBeSynced(['1990', '2010'], OPTIONS)).toBe(false);
    expect(relativeMayBeSynced([], OPTIONS)).toBe(false);
    expect(relativeMayBeSynced(['2000'], { ...OPTIONS, minimumAgeYears: 30 })).toBe(false);
  });
});
