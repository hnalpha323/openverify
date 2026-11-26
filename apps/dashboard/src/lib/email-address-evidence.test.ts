import { describe, expect, it } from 'vitest';
import {
  deniedDomainEmailAddressVerification,
  disposableCheck,
  emailAddressVerification,
  emailComparison,
  mxCheck,
} from '../testing/fixtures/email-address';
import { emailDomainEvidenceOf } from './email-address-evidence';

describe('emailDomainEvidenceOf (C56, C66)', () => {
  it('reads what the disposable check matched and the MX route with its record count', () => {
    expect(emailDomainEvidenceOf(emailAddressVerification())).toEqual({
      disposable: { match: 'none', depth: null },
      mx: { route: 'mx', recordCount: 2 },
    });
  });

  it('reads a denied domain with its depth, and a reserved sandbox name without a count', () => {
    expect(emailDomainEvidenceOf(deniedDomainEmailAddressVerification())).toEqual({
      disposable: { match: 'denied', depth: 0 },
      mx: { route: 'reserved', recordCount: null },
    });
  });

  it('has nothing before the domain checks ran, or when a check recorded nothing', () => {
    expect(emailDomainEvidenceOf(emailAddressVerification({ attributes: { checks: [] } }))).toEqual(
      { disposable: null, mx: null },
    );
    expect(
      emailDomainEvidenceOf(
        emailAddressVerification({
          attributes: {
            checks: [
              emailComparison(),
              disposableCheck({
                status: 'not_applicable',
                reasons: ['list_unavailable'],
                metadata: {},
              }),
              mxCheck({ status: 'not_applicable', reasons: ['execution_error'], metadata: {} }),
            ],
          },
        }),
      ),
    ).toEqual({ disposable: null, mx: null });
  });

  it('counts metadata of the wrong shape as not recorded', () => {
    const odd = emailAddressVerification({
      attributes: {
        checks: [
          disposableCheck({ metadata: { match: 'listed', 'match-depth': -1 } }),
          mxCheck({ metadata: { route: 7, 'record-count': 'two' } }),
        ],
      },
    });

    expect(emailDomainEvidenceOf(odd)).toEqual({
      disposable: { match: 'listed', depth: null },
      mx: null,
    });
  });
});
