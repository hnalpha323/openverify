/**
 * C98.2, C100.4: one row as an item and its key. A refusal is a code and a column; a value that
 * breaks a normaliser unplanned answers `invalid_value` for its own row. Synthetic values.
 */
import type { ImportList } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readImportRow } from './read-row.js';

const checks = vi.hoisted(() => ({ fail: null as Error | null, empty: false }));

vi.mock('@openverify/checks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@openverify/checks')>();
  return {
    ...original,
    listKeyInputs: (...args: Parameters<typeof original.listKeyInputs>) => {
      if (checks.fail !== null) {
        throw checks.fail;
      }
      return checks.empty ? [] : original.listKeyInputs(...args);
    },
  };
});

afterEach(() => {
  checks.fail = null;
  checks.empty = false;
});

const list = (overrides: Partial<ImportList> = {}): ImportList => ({
  id: 'lst_synthetic',
  kind: 'string',
  status: 'active',
  fieldKey: null,
  caseSensitive: false,
  defaultRegion: null,
  ...overrides,
});

const keyOf = (kind: string, input: string) => `${kind}/${input}`;

describe('readImportRow', () => {
  it('answers the item and the key of its first input', () => {
    expect(readImportRow(list(), { row: 2, cells: { value: ' A  b ' } }, keyOf)).toEqual({
      attributes: { value: ' A  b ' },
      matchKey: 'identifier-string/a b',
    });
  });

  it('keys a name by its first form, through the C78 analysis', () => {
    const read = readImportRow(
      list({ kind: 'name' }),
      { row: 2, cells: { name_first: 'Jane', name_last: 'Example' } },
      keyOf,
    );

    expect(read).toEqual({
      attributes: { 'name-first': 'Jane', 'name-last': 'Example' },
      matchKey: 'identifier-name/example|jane',
    });
  });

  it('keys a field by the list’s key', () => {
    const read = readImportRow(
      list({ kind: 'field', fieldKey: 'plan' }),
      { row: 2, cells: { field_value: 'Gold' } },
      keyOf,
    );

    expect(read).toMatchObject({ matchKey: 'identifier-field/plan|gold' });
  });

  it('names the column of a refusal', () => {
    expect(
      readImportRow(list({ kind: 'country' }), { row: 7, cells: { country_code: 'nowhere' } }, keyOf),
    ).toEqual({ error: { row: 7, column: 'country_code', code: 'invalid_value' } });
  });

  it('answers invalid_value for a row with no key at all', () => {
    checks.empty = true;

    expect(readImportRow(list(), { row: 3, cells: { value: 'x' } }, keyOf)).toEqual({
      error: { row: 3, column: null, code: 'invalid_value' },
    });
  });

  it('answers invalid_value, not a failed import, when a normaliser breaks', () => {
    checks.fail = new RangeError('sentinel-person@example.com');

    const read = readImportRow(list(), { row: 4, cells: { value: 'x' } }, keyOf);

    expect(read).toEqual({ error: { row: 4, column: null, code: 'invalid_value' } });
    expect(JSON.stringify(read)).not.toContain('sentinel-person');
  });
});
