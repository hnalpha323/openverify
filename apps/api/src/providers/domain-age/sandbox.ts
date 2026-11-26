/**
 * C61.6: the sandbox domain age provider (sandbox environments only). It calls nothing and answers
 * for reserved names only (RFC 2606, RFC 6761), the host read without a leading `www.`:
 *
 * | Host | Answer |
 * |---|---|
 * | `new.example` | registered 3 days ago (`domain_recently_registered` under the default 90 days) |
 * | `old.example` | registered 20 years ago |
 * | a subdomain of either, such as `shop.old.example` | unavailable, `subdomain` |
 * | `nordap.test` | unavailable, `no_rdap_service` |
 * | anything else | unavailable, `not_found` |
 */
import {
  systemClock,
  type Clock,
  type DomainAgeProvider,
  type DomainAgeResult,
} from '../../ports.js';

/** The sandbox's registered domains and how old each is. */
export const SANDBOX_DOMAIN_AGES = Object.freeze({
  'new.example': { days: 3 },
  'old.example': { years: 20 },
});

/** The sandbox name whose TLD has no RDAP service. */
export const SANDBOX_NO_RDAP_HOST = 'nordap.test';

const DAY_MS = 86_400_000;

/**
 * When a sandbox domain was registered: counted back from the start of `now`'s UTC day, so a job
 * that read its clock a moment before this call still sees whole days (RDAP dates are days too).
 */
function registeredAt(age: { days?: number; years?: number }, now: Date): Date {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (age.days ?? 0) * DAY_MS,
  );
  date.setUTCFullYear(date.getUTCFullYear() - (age.years ?? 0));
  return date;
}

/** The sandbox domain age provider (C61.6): it calls nothing. */
export function createSandboxDomainAgeProvider(clock: Clock = systemClock): DomainAgeProvider {
  const ages: Readonly<Record<string, { days?: number; years?: number }>> = SANDBOX_DOMAIN_AGES;
  return {
    id: 'sandbox',
    sandbox: true,
    age({ host }): Promise<DomainAgeResult> {
      const name = host.startsWith('www.') ? host.slice(4) : host;
      const age = Object.hasOwn(ages, name) ? ages[name] : undefined;
      if (age !== undefined) {
        return Promise.resolve({
          outcome: 'registered',
          registeredAt: registeredAt(age, clock.now()),
          domain: name,
        });
      }
      if (Object.keys(ages).some((domain) => name.endsWith(`.${domain}`))) {
        return Promise.resolve({ outcome: 'unavailable', reason: 'subdomain' });
      }
      return Promise.resolve({
        outcome: 'unavailable',
        reason: name === SANDBOX_NO_RDAP_HOST ? 'no_rdap_service' : 'not_found',
      });
    },
  };
}
