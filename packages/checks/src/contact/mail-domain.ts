/**
 * C56's reserved-domain rule, for sandbox environments only (RFC 2606 / RFC 6761 names): an
 * address at a `*.test` or `*.example` domain accepts mail and one at `*.invalid` does not exist,
 * with no DNS query. In production every domain goes to DNS.
 */
import type { EnvironmentKind } from '../data/feature-table.js';

/** What the sandbox rule says about a domain, or `null` when DNS must answer. */
export type SandboxMailDomainOutcome = 'accepts_mail' | 'not_found';

/** The sandbox answer for a lower-case ASCII domain, or `null` (production, or not reserved). */
export function sandboxMailDomainRule(
  domain: string,
  environment: EnvironmentKind,
): SandboxMailDomainOutcome | null {
  if (environment !== 'sandbox') {
    return null;
  }
  if (domain.endsWith('.test') || domain.endsWith('.example')) {
    return 'accepts_mail';
  }
  return domain.endsWith('.invalid') ? 'not_found' : null;
}
