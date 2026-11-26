import { describe, expect, it } from 'vitest';
import {
  matching,
  oneOf,
  queryValue,
  readFilters,
  splitList,
  utcTime,
  utcTimestamp,
} from './filter-values';

describe('splitList', () => {
  it('splits on commas, spaces and new lines, dropping empty items', () => {
    expect(splitList(' a, b\nc  d,,\r\n')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitList('')).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('queryValue', () => {
  it('trims a value and treats an empty one as absent', () => {
    expect(queryValue({ status: ' failed ' }, 'status')).toBe('failed');
    expect(queryValue({ status: '  ' }, 'status')).toBeUndefined();
    expect(queryValue({}, 'status')).toBeUndefined();
  });

  it('takes the first of a repeated parameter', () => {
    expect(queryValue({ status: ['failed', 'pending'] }, 'status')).toBe('failed');
    expect(queryValue({ status: [] }, 'status')).toBeUndefined();
  });
});

describe('utcTimestamp', () => {
  it('reads a datetime-local value as UTC', () => {
    expect(utcTimestamp('2026-10-20T10:05')).toBe('2026-10-20T10:05:00.000Z');
    expect(utcTimestamp('2026-10-20T10:05:30')).toBe('2026-10-20T10:05:30.000Z');
  });

  it('takes the fractional seconds a browser may add to a value with seconds', () => {
    expect(utcTimestamp('2026-10-20T10:05:30.000')).toBe('2026-10-20T10:05:30.000Z');
    expect(utcTimestamp('2026-10-20T10:05:30.250')).toBe('2026-10-20T10:05:30.250Z');
  });

  it('refuses anything else, including dates that do not exist', () => {
    expect(utcTimestamp('2026-10-20')).toBeUndefined();
    expect(utcTimestamp('2026-10-20T10:05Z')).toBeUndefined();
    expect(utcTimestamp('2026-02-30T10:00')).toBeUndefined();
    expect(utcTimestamp('2026-13-01T10:00')).toBeUndefined();
    expect(utcTimestamp('yesterday')).toBeUndefined();
  });
});

describe('readFilters', () => {
  const checks = {
    status: oneOf(['pending', 'failed'], 'Choose a status from the list.'),
    'event-id': matching(/^evt_[0-9A-Z]{26}$/, 'Enter an event ID such as evt_….'),
    'created-at-start': utcTime,
    'created-at-end': utcTime,
  };

  it('keeps the values for the form and applies the valid ones', () => {
    const read = readFilters(
      { status: 'failed', 'event-id': 'evt_x', 'created-at-start': '2026-10-20T10:00' },
      checks,
    );

    expect(read.values).toEqual({
      status: 'failed',
      'event-id': 'evt_x',
      'created-at-start': '2026-10-20T10:00',
    });
    expect(read.applied).toEqual({
      status: 'failed',
      'created-at-start': '2026-10-20T10:00:00.000Z',
    });
    expect(read.errors).toEqual({ 'event-id': 'Enter an event ID such as evt_….' });
  });

  it('says why a time is not applied', () => {
    expect(readFilters({ 'created-at-end': 'soon' }, checks).errors).toEqual({
      'created-at-end': 'Enter a date and time.',
    });
  });

  it('refuses a range that ends before it starts, keeping the start', () => {
    const read = readFilters(
      { 'created-at-start': '2026-10-20T10:00', 'created-at-end': '2026-10-20T09:00' },
      checks,
    );

    expect(read.applied).toEqual({ 'created-at-start': '2026-10-20T10:00:00.000Z' });
    expect(read.errors).toEqual({ 'created-at-end': 'Choose an end after the start.' });
  });

  it('ignores parameters it does not know', () => {
    const read = readFilters({ secret: 'x', status: 'pending' }, checks);

    expect(read.values).toEqual({ status: 'pending' });
    expect(read.applied).toEqual({ status: 'pending' });
  });
});
