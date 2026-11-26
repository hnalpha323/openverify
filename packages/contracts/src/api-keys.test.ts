import { describe, expect, it } from 'vitest';
import {
  API_KEY_EXPIRE_MAX_SECONDS,
  API_KEY_TOKEN_PREFIXES,
  MAX_API_KEY_ALLOWED_IPS,
  MAX_API_KEY_CASE_TEMPLATES,
  allowedIpsSchema,
  apiKeyDocumentSchema,
  apiKeyListDocumentSchema,
  apiKeyResourceSchema,
  apiKeyTokenPrefix,
  apiKeyTokenSchema,
  buildApiKeyResource,
  cloneApiKeyBodySchema,
  createApiKeyBodySchema,
  createdApiKeyDocumentSchema,
  expireApiKeyBodySchema,
  listApiKeysQuerySchema,
  updateApiKeyBodySchema,
} from './api-keys.js';
import { newId } from './ids.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';

const token = `ov_sbx_AbC9${'x'.repeat(39)}`;

const apiKey = {
  type: 'api-key',
  id: IDS.serverIntegration,
  attributes: {
    name: 'Sandbox backend',
    scopes: ['inquiries:read', 'inquiries:write'],
    'allowed-ips': ['203.0.113.0/24', '2001:db8::/32'],
    'api-version': '2026-10-01',
    'token-prefix': 'ov_sbx_AbC9',
    'expires-at': null,
    'last-used-at': LATER_ISO,
    'created-at': AT_ISO,
  },
};

describe('api-key resource (C12)', () => {
  it('describes a key by its token prefix, never its secret', () => {
    expect(apiKeyResourceSchema.parse(apiKey)).toEqual(apiKey);
    expect(apiKeyDocumentSchema.safeParse({ data: apiKey }).success).toBe(true);
    expect(
      apiKeyListDocumentSchema.safeParse({ data: [apiKey], links: { next: null } }).success,
    ).toBe(true);
    const leaked = { ...apiKey, attributes: { ...apiKey.attributes, token } };
    expect(apiKeyResourceSchema.safeParse(leaked).success).toBe(false);
  });

  it.each([
    ['an unknown scope', { scopes: ['inquiry.write'] }],
    ['a user-only permission', { scopes: ['pii:view'] }],
    ['duplicate scopes', { scopes: ['events:read', 'events:read'] }],
    ['a bare environment prefix', { 'token-prefix': 'ov_sbx_' }],
    ['a foreign prefix', { 'token-prefix': 'sk_live_AbC9' }],
    ['an unknown API version', { 'api-version': '2025-01-01' }],
    ['an IP without a mask', { 'allowed-ips': ['203.0.113.7'] }],
  ])('rejects %s', (_name, change) => {
    const value = { ...apiKey, attributes: { ...apiKey.attributes, ...change } };
    expect(apiKeyResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from an API key record', () => {
    expect(
      buildApiKeyResource({
        id: IDS.serverIntegration,
        name: 'Sandbox backend',
        scopes: ['inquiries:read', 'inquiries:write'],
        allowedIps: ['203.0.113.0/24', '2001:db8::/32'],
        apiVersion: '2026-10-01',
        tokenPrefix: 'ov_sbx_AbC9',
        expiresAt: null,
        lastUsedAt: LATER,
        createdAt: AT,
      }),
    ).toEqual(apiKey);
    const expiring = buildApiKeyResource({
      id: IDS.serverIntegration,
      name: 'Old key',
      scopes: [],
      allowedIps: [],
      apiVersion: '2026-10-01',
      tokenPrefix: 'ov_prod_ZZZZ',
      expiresAt: LATER,
      lastUsedAt: null,
      createdAt: AT,
    });
    expect(expiring.attributes).toMatchObject({ 'expires-at': LATER_ISO, 'last-used-at': null });
  });
});

describe('API key tokens (C12)', () => {
  it('start with the environment prefix', () => {
    expect(API_KEY_TOKEN_PREFIXES).toEqual({ sandbox: 'ov_sbx_', production: 'ov_prod_' });
    expect(apiKeyTokenSchema.safeParse(token).success).toBe(true);
    expect(apiKeyTokenSchema.safeParse(`ov_prod_${'A'.repeat(43)}`).success).toBe(true);
    expect(apiKeyTokenSchema.safeParse(`ov_dev_${'A'.repeat(43)}`).success).toBe(false);
  });

  it('show the environment prefix and the first 4 secret characters', () => {
    expect(apiKeyTokenPrefix(token)).toBe('ov_sbx_AbC9');
    expect(apiKeyTokenPrefix(`ov_prod_${'A'.repeat(43)}`)).toBe('ov_prod_AAAA');
    expect(() => apiKeyTokenPrefix('ov_sbx_short')).toThrow(TypeError);
  });
});

describe('API key requests (C12)', () => {
  it('create a key with scopes, allowed IPs and an API version', () => {
    const body = {
      data: {
        attributes: {
          name: 'Backend',
          scopes: ['inquiries:read'],
          'allowed-ips': ['10.0.0.0/8'],
          'api-version': '2026-10-01',
        },
      },
    };
    expect(createApiKeyBodySchema.parse(body)).toEqual(body);
    expect(
      createApiKeyBodySchema.safeParse({ data: { attributes: { name: 'x', scopes: [] } } }).success,
    ).toBe(false);
  });

  it('return the token exactly once, matching the prefix', () => {
    expect(createdApiKeyDocumentSchema.parse({ data: apiKey, meta: { token } })).toEqual({
      data: apiKey,
      meta: { token },
    });
    expect(
      createdApiKeyDocumentSchema.safeParse({
        data: apiKey,
        meta: { token: `ov_sbx_ZZZZ${'x'.repeat(39)}` },
      }).success,
    ).toBe(false);
  });

  it('update the name or allowed IPs only', () => {
    expect(
      updateApiKeyBodySchema.safeParse({ data: { attributes: { 'allowed-ips': [] } } }).success,
    ).toBe(true);
    expect(updateApiKeyBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      updateApiKeyBodySchema.safeParse({ data: { attributes: { scopes: ['events:read'] } } })
        .success,
    ).toBe(false);
  });

  it('allow at most 50 distinct CIDR ranges', () => {
    expect(MAX_API_KEY_ALLOWED_IPS).toBe(50);
    expect(allowedIpsSchema.safeParse(['10.0.0.0/8', '10.0.0.0/8']).success).toBe(false);
    expect(
      allowedIpsSchema.safeParse(Array.from({ length: 51 }, (_, i) => `10.0.${String(i)}.0/24`))
        .success,
    ).toBe(false);
  });

  it('clone with an optional new name', () => {
    expect(cloneApiKeyBodySchema.parse(undefined)).toBeUndefined();
    expect(cloneApiKeyBodySchema.parse({ meta: { name: 'Copy' } })).toEqual({
      meta: { name: 'Copy' },
    });
  });

  it('expire now or within 30 days', () => {
    expect(API_KEY_EXPIRE_MAX_SECONDS).toBe(2_592_000);
    expect(expireApiKeyBodySchema.parse({ meta: { 'expires-in-seconds': 0 } })).toEqual({
      meta: { 'expires-in-seconds': 0 },
    });
    for (const seconds of [-1, 2_592_001, 1.5]) {
      expect(
        expireApiKeyBodySchema.safeParse({ meta: { 'expires-in-seconds': seconds } }).success,
      ).toBe(false);
    }
    expect(expireApiKeyBodySchema.safeParse({ meta: {} }).success).toBe(false);
  });

  it('paginate by key id', () => {
    expect(listApiKeysQuerySchema.parse({ 'page[after]': IDS.serverIntegration })).toEqual({
      'page[after]': IDS.serverIntegration,
    });
  });
});

describe('API key expiry on creation and pii-masked (C25.5, C25.6, Workflow 2E)', () => {
  const create = (attributes: Record<string, unknown>) =>
    createApiKeyBodySchema.safeParse({
      data: { attributes: { name: 'Backend', scopes: ['inquiries:read'], ...attributes } },
    });

  it('create a key that expires in 1 second to 30 days, or never without it', () => {
    expect(create({ 'expires-in-seconds': 1 }).success).toBe(true);
    expect(create({ 'expires-in-seconds': 2_592_000 }).success).toBe(true);
    expect(create({}).success).toBe(true);
    for (const seconds of [0, -1, 2_592_001, 1.5, '60']) {
      expect(create({ 'expires-in-seconds': seconds }).success, String(seconds)).toBe(false);
    }
  });

  it('show whether the key sees PII masked, a read-only boolean earlier answers lack', () => {
    for (const piiMasked of [true, false]) {
      const value = { ...apiKey, attributes: { ...apiKey.attributes, 'pii-masked': piiMasked } };
      expect(apiKeyResourceSchema.parse(value)).toEqual(value);
    }
    expect(apiKeyResourceSchema.parse(apiKey)).toEqual(apiKey);
    expect(
      apiKeyResourceSchema.safeParse({
        ...apiKey,
        attributes: { ...apiKey.attributes, 'pii-masked': 'yes' },
      }).success,
    ).toBe(false);
  });

  it('build pii-masked from the record', () => {
    const built = buildApiKeyResource({
      id: IDS.serverIntegration,
      name: 'Masked key',
      scopes: ['inquiries:read'],
      allowedIps: [],
      apiVersion: '2026-10-01',
      tokenPrefix: 'ov_sbx_AbC9',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: AT,
      piiMasked: true,
    });
    expect(built.attributes).toMatchObject({ 'pii-masked': true });
  });

  it('cannot be set on update', () => {
    expect(
      updateApiKeyBodySchema.safeParse({ data: { attributes: { 'pii-masked': false } } }).success,
    ).toBe(false);
  });
});

describe('case-template-ids (C129.4, P14)', () => {
  const CASE_TEMPLATE = 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN';

  it('serves the templates a key may read beside the unrestricted ones', () => {
    const resource = buildApiKeyResource({
      id: IDS.serverIntegration,
      name: 'Sandbox backend',
      scopes: ['cases:read'],
      allowedIps: [],
      apiVersion: '2026-10-01',
      tokenPrefix: 'ov_sbx_AbC9',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: AT,
      caseTemplateIds: [CASE_TEMPLATE],
    });
    expect(resource.attributes['case-template-ids']).toEqual([CASE_TEMPLATE]);
  });

  it('is set when the key is minted, and never on a later change', () => {
    const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });
    const minted = createApiKeyBodySchema.safeParse(
      body({ name: 'K', scopes: ['cases:read'], 'case-template-ids': [CASE_TEMPLATE] }),
    );
    expect(minted.success).toBe(true);
    expect(
      updateApiKeyBodySchema.safeParse(body({ 'case-template-ids': [CASE_TEMPLATE] })).success,
    ).toBe(false);
  });

  it('refuses anything but distinct template ids, up to the cap', () => {
    const minted = (ids: unknown) =>
      createApiKeyBodySchema.safeParse({
        data: { attributes: { name: 'K', scopes: ['cases:read'], 'case-template-ids': ids } },
      }).success;
    expect(minted([])).toBe(true);
    expect(minted([CASE_TEMPLATE, CASE_TEMPLATE])).toBe(false);
    expect(minted(['itmpl_01M5CK3190XEVBM5ZXA76E1JSN'])).toBe(false);
    const ids = (count: number) => Array.from({ length: count }, () => newId('ctmpl'));
    expect(minted(ids(MAX_API_KEY_CASE_TEMPLATES))).toBe(true);
    expect(minted(ids(MAX_API_KEY_CASE_TEMPLATES + 1))).toBe(false);
  });
});
