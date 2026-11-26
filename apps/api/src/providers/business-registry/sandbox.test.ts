/**
 * C61.6: the sandbox register's documented answers, read from the registration number's last four
 * letters or digits; without a magic ending it echoes the input as an active, authoritative record
 * listing the sandbox officer and PSC. It calls nothing. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import type { BusinessRegistryRequest } from '../../ports.js';
import {
  SANDBOX_REGISTRY_MAGIC,
  SANDBOX_REGISTRY_OTHER_PERSONS,
  SANDBOX_REGISTRY_PERSONS,
  createSandboxRegister,
} from './sandbox.js';

const REQUEST: BusinessRegistryRequest = {
  country: 'GB',
  businessName: 'Utopia Synthetic Widgets Ltd',
  registrationNumber: '01234567',
  address: {
    street1: '1 Placeholder Row',
    city: 'Utopia Town',
    postalCode: 'UT1 0ZZ',
  },
};

const lookup = (request: BusinessRegistryRequest) => createSandboxRegister().lookup(request);

describe('the sandbox register (C61.6)', () => {
  it('is the sandbox provider', () => {
    expect(createSandboxRegister()).toMatchObject({ id: 'sandbox', sandbox: true });
  });

  it('echoes the input as an active, authoritative record with the sandbox officer and PSC', async () => {
    expect(await lookup(REQUEST)).toEqual({
      outcome: 'found',
      authoritative: true,
      personsAvailable: true,
      record: {
        source: 'sandbox',
        recordId: '01234567',
        legalName: 'Utopia Synthetic Widgets Ltd',
        otherNames: [],
        status: 'active',
        statusDetail: null,
        registeredAddress: {
          lines: ['1 Placeholder Row'],
          city: 'Utopia Town',
          region: null,
          postalCode: 'UT1 0ZZ',
          country: 'GB',
        },
        jurisdiction: 'GB',
        registrationNumber: '01234567',
        persons: SANDBOX_REGISTRY_PERSONS,
      },
    });
  });

  it('echoes a business entered without a number under a record id derived from its name', async () => {
    const answer = await lookup({ country: 'US', businessName: 'Utopia Synthetic Widgets Inc' });

    expect(answer).toMatchObject({
      outcome: 'found',
      record: {
        recordId: expect.stringMatching(/^sandbox-[0-9a-f]{12}$/) as unknown,
        registrationNumber: null,
      },
    });
    expect(JSON.stringify(answer)).not.toContain('"recordId":"Utopia');
  });

  it('reads 0000 as a record of another business: another name, number and address', async () => {
    const answer = await lookup({ ...REQUEST, registrationNumber: 'SC120000' });

    expect(answer.outcome).toBe('found');
    if (answer.outcome !== 'found') {
      return;
    }
    expect(answer.record.legalName).not.toBe(REQUEST.businessName);
    expect(answer.record.registrationNumber).not.toBe('SC120000');
    expect(answer.record.registeredAddress?.lines).not.toEqual(['1 Placeholder Row']);
    expect(answer.record.registeredAddress?.postalCode).not.toBe('UT1 0ZZ');
  });

  it('reads 9999 as not found by an authoritative register', async () => {
    expect(await lookup({ ...REQUEST, registrationNumber: '12349999' })).toEqual({
      outcome: 'not_found',
      authoritative: true,
    });
  });

  it('reads 8888 as the business, dissolved', async () => {
    expect(await lookup({ ...REQUEST, registrationNumber: '12348888' })).toMatchObject({
      outcome: 'found',
      record: { legalName: REQUEST.businessName, status: 'dissolved' },
    });
  });

  it('reads 7777 as the business with officers that do not include the sandbox officer or PSC', async () => {
    const answer = await lookup({ ...REQUEST, registrationNumber: '12347777' });

    expect(answer).toMatchObject({
      outcome: 'found',
      record: { status: 'active', persons: SANDBOX_REGISTRY_OTHER_PERSONS },
    });
  });

  it('reads the last four letters or digits only, upper-cased', async () => {
    expect(SANDBOX_REGISTRY_MAGIC).toEqual({
      identityMismatch: '0000',
      notFound: '9999',
      inactive: '8888',
      personNotOnRegister: '7777',
    });
    expect(await lookup({ ...REQUEST, registrationNumber: 'ab-99-99' })).toMatchObject({
      outcome: 'not_found',
    });
    expect(await lookup({ ...REQUEST, registrationNumber: '99990001' })).toMatchObject({
      outcome: 'found',
      record: { status: 'active' },
    });
  });

  it('covers every country', async () => {
    for (const country of ['GB', 'US', 'DE', 'JP']) {
      expect((await lookup({ ...REQUEST, country })).outcome).toBe('found');
    }
  });
});
