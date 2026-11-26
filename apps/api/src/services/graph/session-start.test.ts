/**
 * K7A-10 (C93.7): the session start's graph index never rolls the start back, and a failure leaves
 * a trace: one warning with the error's name only, never the address, the session's IP or a key.
 * The address is from a documentation range.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../../jobs/testing.js';
import { indexSessionAddressInTx } from './session-start.js';

const ADDRESS = '203.0.113.9';
const SESSION = { id: 'iqse_1', environmentId: 'env_1', inquiryId: 'inq_1' };

function failingTx(error: Error): Db {
  return { transaction: () => Promise.reject(error) } as unknown as Db;
}

describe('indexSessionAddressInTx (K7A-10)', () => {
  it('logs a failed indexer once, with the error’s name only, and answers 0', async () => {
    const logger = createCapturingLogger();

    const written = await indexSessionAddressInTx(
      failingTx(new RangeError(`no row for ${ADDRESS}`)),
      SESSION,
      { networkId: 'net_1' },
      { ip: ADDRESS },
      logger,
    );

    expect(written).toBe(0);
    expect(logger.entries).toMatchObject([
      { level: 'warn', message: 'session address not indexed', object: { error: 'RangeError' } },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(ADDRESS);
  });

  it('logs nothing when no network row was written: there is no address to index', async () => {
    const logger = createCapturingLogger();

    await indexSessionAddressInTx(failingTx(new Error('unused')), SESSION, null, { ip: ADDRESS }, logger);

    expect(logger.entries).toEqual([]);
  });
});
