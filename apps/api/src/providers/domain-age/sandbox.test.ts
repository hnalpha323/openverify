/**
 * C61.6: the sandbox domain age provider's documented answers, on reserved names only, with no
 * request: new.example 3 days old, old.example 20 years, their subdomains `subdomain`, nordap.test
 * `no_rdap_service`, anything else `not_found`; a leading `www.` is read off.
 */
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../test-support/fakes.js';
import {
  SANDBOX_DOMAIN_AGES,
  SANDBOX_NO_RDAP_HOST,
  createSandboxDomainAgeProvider,
} from './sandbox.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const sandbox = () => createSandboxDomainAgeProvider(fixedClock(NOW));

describe('the sandbox domain age provider (C61.6)', () => {
  it('is the sandbox provider', () => {
    expect(sandbox()).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(SANDBOX_DOMAIN_AGES).toEqual({
      'new.example': { days: 3 },
      'old.example': { years: 20 },
    });
    expect(SANDBOX_NO_RDAP_HOST).toBe('nordap.test');
  });

  it('ages new.example three days and old.example twenty years, with or without www., from the start of the UTC day', async () => {
    expect(await sandbox().age({ host: 'new.example' })).toEqual({
      outcome: 'registered',
      registeredAt: new Date('2026-10-21T00:00:00.000Z'),
      domain: 'new.example',
    });
    expect(await sandbox().age({ host: 'www.old.example' })).toEqual({
      outcome: 'registered',
      registeredAt: new Date('2006-10-24T00:00:00.000Z'),
      domain: 'old.example',
    });
  });

  it('is three whole days old to a job whose clock was read a moment before the provider’s', async () => {
    const answer = await sandbox().age({ host: 'new.example' });
    const jobNow = NOW.getTime() - 1_000;
    expect(answer.outcome).toBe('registered');
    if (answer.outcome === 'registered') {
      expect(Math.floor((jobNow - answer.registeredAt.getTime()) / 86_400_000)).toBe(3);
    }
  });

  it('answers a subdomain of either as unavailable, never aged by its parent', async () => {
    expect(await sandbox().age({ host: 'shop.old.example' })).toEqual({
      outcome: 'unavailable',
      reason: 'subdomain',
    });
    expect(await sandbox().age({ host: 'a.b.new.example' })).toEqual({
      outcome: 'unavailable',
      reason: 'subdomain',
    });
  });

  it('answers nordap.test as a TLD without RDAP, and any other name as not found', async () => {
    expect(await sandbox().age({ host: 'nordap.test' })).toEqual({
      outcome: 'unavailable',
      reason: 'no_rdap_service',
    });
    for (const host of ['utopia-widgets.example', 'example.com', 'oldexample.test']) {
      expect(await sandbox().age({ host })).toEqual({
        outcome: 'unavailable',
        reason: 'not_found',
      });
    }
  });
});
