import { describe, expect, it } from 'vitest';
import {
  MULTI_TENANT_SEGMENTS,
  SHARED_ISSUERS,
  TENANT_ID_PLACEHOLDER,
  discoveryUrlOf,
  expectedIdTokenIssuer,
  isMultiTenantIssuer,
} from './issuer.js';

const ORIGIN = 'https://idp.example.com';

describe('issuers (C248.3, review P07)', () => {
  it('knows the multi-tenant issuer shapes', () => {
    for (const segment of MULTI_TENANT_SEGMENTS) {
      expect(isMultiTenantIssuer(`${ORIGIN}/${segment}/v2.0`)).toBe(true);
    }
    expect(isMultiTenantIssuer(`${ORIGIN}/${TENANT_ID_PLACEHOLDER}/v2.0`)).toBe(true);
    expect(isMultiTenantIssuer(`${ORIGIN}/tenant-synthetic-0001/v2.0`)).toBe(false);
    expect(isMultiTenantIssuer(`${ORIGIN}/oauth2/default`)).toBe(false);
    expect(isMultiTenantIssuer(`${ORIGIN}/commonplace/v2.0`)).toBe(false);
  });

  it('treats the Google shape’s shared issuer, and any listed one, as multi-tenant', () => {
    const [shared] = SHARED_ISSUERS;
    expect(shared).toBeDefined();
    expect(isMultiTenantIssuer(shared ?? '')).toBe(true);
    expect(isMultiTenantIssuer(`${shared ?? ''}/`)).toBe(true);
    expect(isMultiTenantIssuer('http://127.0.0.1:4000')).toBe(false);
    expect(isMultiTenantIssuer('http://127.0.0.1:4000', ['http://127.0.0.1:4000'])).toBe(true);
    expect(isMultiTenantIssuer('not a url')).toBe(false);
  });

  it('finds the discovery document under the issuer', () => {
    expect(discoveryUrlOf(`${ORIGIN}/oauth2/default`)).toBe(
      `${ORIGIN}/oauth2/default/.well-known/openid-configuration`,
    );
    expect(discoveryUrlOf(`${ORIGIN}/`)).toBe(`${ORIGIN}/.well-known/openid-configuration`);
    expect(discoveryUrlOf(ORIGIN)).toBe(`${ORIGIN}/.well-known/openid-configuration`);
  });

  it('expects the stored issuer exactly when discovery names it', () => {
    expect(expectedIdTokenIssuer(`${ORIGIN}/a`, `${ORIGIN}/a`, null)).toBe(`${ORIGIN}/a`);
    expect(expectedIdTokenIssuer(`${ORIGIN}/a`, `${ORIGIN}/a/`, null)).toBeNull();
    expect(expectedIdTokenIssuer(`${ORIGIN}/a`, 'https://other.example.org/a', null)).toBeNull();
  });

  it('fills the {tenantid} template only with a tid pin on the same origin', () => {
    const template = `${ORIGIN}/${TENANT_ID_PLACEHOLDER}/v2.0`;
    const tid = { claim: 'tid' as const, value: 'tenant-synthetic-0001' };
    expect(expectedIdTokenIssuer(`${ORIGIN}/common/v2.0`, template, tid)).toBe(
      `${ORIGIN}/tenant-synthetic-0001/v2.0`,
    );
    expect(expectedIdTokenIssuer(`${ORIGIN}/common/v2.0`, template, null)).toBeNull();
    expect(
      expectedIdTokenIssuer(`${ORIGIN}/common/v2.0`, template, {
        claim: 'hd',
        value: 'example.com',
      }),
    ).toBeNull();
    expect(
      expectedIdTokenIssuer(
        `${ORIGIN}/common/v2.0`,
        `https://other.example.org/${TENANT_ID_PLACEHOLDER}/v2.0`,
        tid,
      ),
    ).toBeNull();
  });
});
