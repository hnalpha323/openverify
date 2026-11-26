/**
 * C82.4: the sandbox `emailIntelligence` provider (sandbox environments only, ADR 0002 §3d). It
 * calls nothing and answers by the address's local part:
 *
 * | Local part | Answer |
 * |---|---|
 * | holds `sandbox-breached` | one breach, 90 days before the clock's time (a recent breach) |
 * | anything else, `sandbox-spam` included | no breach |
 *
 * `sandbox-spam` is reserved: `email-is-spam` has no adapter in Phase 6 and is always `null`, so
 * the token changes nothing yet.
 */
import { systemClock, type Clock, type EmailIntelligenceProvider } from '../../ports.js';

/** C82.4: the sandbox's magic local-part token, and how long ago its breach was. */
export const SANDBOX_BREACHED_TOKEN = 'sandbox-breached';
export const SANDBOX_BREACH_DAYS_AGO = 90;

const DAY_MS = 86_400_000;

/** The sandbox provider (C82.4): it calls nothing. */
export function createSandboxEmailIntelligenceProvider(
  clock: Clock = systemClock,
): EmailIntelligenceProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    breaches({ emailAddress }) {
      const local = emailAddress.slice(0, Math.max(0, emailAddress.lastIndexOf('@')));
      return Promise.resolve(
        local.includes(SANDBOX_BREACHED_TOKEN)
          ? {
              breachCount: 1,
              latestBreachAt: new Date(clock.now().getTime() - SANDBOX_BREACH_DAYS_AGO * DAY_MS),
            }
          : { breachCount: 0, latestBreachAt: null },
      );
    },
  };
}
