/**
 * D001 (6D review): a source whose frequency table is too large to read whole answers that once. The
 * reader then goes key by key, and must not ask for the table again on every chunk: that count is
 * the expensive statement the reader exists to avoid.
 */
import type { Db } from '@openverify/db';
import { watchlistKeyFrequencies, watchlistKeyFrequencyTable } from '@openverify/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keyFrequencyReader } from './rescreen.js';

vi.mock('@openverify/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openverify/db')>()),
  watchlistKeyFrequencyTable: vi.fn(),
  watchlistKeyFrequencies: vi.fn(),
}));

const DB = {} as Db;

beforeEach(() => {
  vi.mocked(watchlistKeyFrequencyTable).mockReset();
  vi.mocked(watchlistKeyFrequencies).mockReset();
});

describe('keyFrequencyReader (D001)', () => {
  it('asks once whether the table fits, however many chunks read it', async () => {
    vi.mocked(watchlistKeyFrequencyTable).mockResolvedValue(null);
    vi.mocked(watchlistKeyFrequencies).mockResolvedValue(new Map([['a', 2]]));
    const read = keyFrequencyReader(DB, 'source', 10);

    await read(['a']);
    await read(['a', 'b']);
    await read(['c']);

    expect(watchlistKeyFrequencyTable).toHaveBeenCalledTimes(1);
  });

  it('reads each key once, and answers a key with no entry as 0', async () => {
    vi.mocked(watchlistKeyFrequencyTable).mockResolvedValue(null);
    vi.mocked(watchlistKeyFrequencies).mockResolvedValue(new Map([['a', 2]]));
    const read = keyFrequencyReader(DB, 'source', 10);

    await read(['a']);
    const answer = await read(['a', 'b']);

    expect(vi.mocked(watchlistKeyFrequencies).mock.calls.map(([, , keys]) => keys)).toEqual([
      ['a'],
      ['b'],
    ]);
    expect(answer.get('a')).toBe(2);
    expect(answer.get('b')).toBe(0);
  });

  it('reads a table that fits once, and no key by key', async () => {
    const table = new Map([['a', 1]]);
    vi.mocked(watchlistKeyFrequencyTable).mockResolvedValue(table);
    const read = keyFrequencyReader(DB, 'source', 10);

    expect(await read(['a'])).toBe(table);
    expect(await read(['b'])).toBe(table);
    expect(watchlistKeyFrequencyTable).toHaveBeenCalledTimes(1);
    expect(watchlistKeyFrequencies).not.toHaveBeenCalled();
  });
});
