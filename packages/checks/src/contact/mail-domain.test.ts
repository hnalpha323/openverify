/** C56: the reserved-domain rule of sandbox environments (RFC 2606, RFC 6761). */
import { describe, expect, it } from 'vitest';
import { sandboxMailDomainRule } from './mail-domain.js';

describe('sandboxMailDomainRule (C56)', () => {
  it.each([
    ['inbox.test', 'accepts_mail'],
    ['mail.inbox.test', 'accepts_mail'],
    ['company.example', 'accepts_mail'],
    ['nowhere.invalid', 'not_found'],
    ['a.b.invalid', 'not_found'],
  ] as const)(
    'answers %s with %s in a sandbox environment, with no DNS query',
    (domain, outcome) => {
      expect(sandboxMailDomainRule(domain, 'sandbox')).toBe(outcome);
    },
  );

  it.each(['example.com', 'example.org', 'test.example.com', 'testing.org', 'invalid.org', 'test'])(
    'leaves %s to DNS',
    (domain) => {
      expect(sandboxMailDomainRule(domain, 'sandbox')).toBeNull();
    },
  );

  it('never applies in a production environment', () => {
    for (const domain of ['inbox.test', 'company.example', 'nowhere.invalid']) {
      expect(sandboxMailDomainRule(domain, 'production')).toBeNull();
    }
  });
});
