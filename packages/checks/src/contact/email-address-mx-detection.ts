/**
 * `email_address_mx_detection` (R, user behaviour, advisory by default, C56): the address's domain
 * exists and accepts mail, by DNS only (no SMTP probe, which is unreliable and abusive).
 *
 * MX records with a usable exchange pass; only null MX records (RFC 7505) fail
 * `domain_rejects_mail`; NXDOMAIN fails `domain_not_found`; no MX falls back to the domain's own A
 * and AAAA records (the RFC 5321 §5.1 implicit MX) and neither fails `no_mail_server`; a lookup
 * that failed after its retries answers `execution_error`, and no lookup at all
 * `provider_not_configured`, never a pass. In a sandbox environment the reserved names decide
 * without DNS (`sandboxMailDomainRule`). No valid address answers `input_missing`. Metadata holds
 * the route and the record count, never a host name.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { EmailAddressContext } from './context.js';
import { sandboxMailDomainRule } from './mail-domain.js';

const CHECK_ID = 'email_address_mx_detection';

export function emailAddressMxDetection(context: EmailAddressContext): CheckResult {
  const { domain } = context;
  if (domain === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing']);
  }
  const reserved = sandboxMailDomainRule(domain, context.environment);
  if (reserved !== null) {
    return reserved === 'accepts_mail'
      ? checkResult(CHECK_ID, 'passed', [], { route: 'reserved' })
      : checkResult(CHECK_ID, 'failed', ['domain_not_found'], { route: 'reserved' });
  }
  const outcome = context.input.mx;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(CHECK_ID, 'not_applicable', ['provider_not_configured']);
  }
  if (outcome.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error']);
  }
  const options = { provider: outcome.provider };
  const { result } = outcome;
  switch (result.kind) {
    case 'not_found':
      return checkResult(CHECK_ID, 'failed', ['domain_not_found'], { route: 'nxdomain' }, options);
    case 'no_mx': {
      const metadata = { route: 'implicit', 'record-count': result.addressRecords };
      return result.addressRecords > 0
        ? checkResult(CHECK_ID, 'passed', [], metadata, options)
        : checkResult(CHECK_ID, 'failed', ['no_mail_server'], metadata, options);
    }
    case 'mx': {
      if (result.exchanges.length === 0) {
        // An MX answer without a record is no answer: the resolver should have said NODATA.
        return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], {}, options);
      }
      const count = result.exchanges.length;
      return result.exchanges.some((exchange) => !isNullMx(exchange))
        ? checkResult(CHECK_ID, 'passed', [], { route: 'mx', 'record-count': count }, options)
        : checkResult(
            CHECK_ID,
            'failed',
            ['domain_rejects_mail'],
            { route: 'null_mx', 'record-count': count },
            options,
          );
    }
  }
}

/** RFC 7505: a null MX names the root, written `.` or, as Node returns it, the empty name. */
function isNullMx(exchange: string): boolean {
  return exchange === '' || exchange === '.';
}
