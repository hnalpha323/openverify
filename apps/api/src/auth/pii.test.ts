import { PII_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import { MASKED_ATTRIBUTE_NAMES } from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';
import { PermissionDeniedError } from '../errors.js';
import type { ApiKeyPrincipal, UserPrincipal } from '../ports.js';
import { canViewPii, MASKED_ATTRIBUTES, piiMaskFor, requirePiiView, UNMASKED } from './pii.js';

// Synthetic principals and values only.
const apiKey = (permissions: Iterable<Permission> = []): ApiKeyPrincipal => ({
  kind: 'api-key',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  permissions: new Set(permissions),
});

const user = (permissions: Iterable<Permission>): UserPrincipal => ({
  kind: 'user',
  userId: 'usr_1',
  userSessionId: 'uss_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  permissions: new Set(permissions),
  mfaSatisfied: true,
});

const reviewer = user(['inquiries:read', 'pii:view']);
const viewer = user(PERMISSIONS.filter((permission) => permission !== 'pii:view'));

const FIELDS = { name_first: 'Synthetic', birth_year: 1990, is_test: true, nickname: null };

describe('canViewPii (C15)', () => {
  it('lets every API key see PII: its scopes already gate it', () => {
    expect(canViewPii(apiKey())).toBe(true);
  });

  it('masks PII for an API key minted by a principal that could not see it (2B F001)', () => {
    expect(canViewPii({ ...apiKey(PERMISSIONS), piiMasked: true })).toBe(false);
    expect(piiMaskFor({ ...apiKey(PERMISSIONS), piiMasked: true }).visible).toBe(false);
    expect(canViewPii({ ...apiKey(), piiMasked: false })).toBe(true);
  });

  it('lets a user see PII only with pii:view', () => {
    expect(canViewPii(reviewer)).toBe(true);
    expect(canViewPii(viewer)).toBe(false);
  });
});

describe('piiMaskFor', () => {
  it('leaves every value as it is for a principal that may see PII', () => {
    const mask = piiMaskFor(reviewer);

    expect(mask.visible).toBe(true);
    expect(mask.fields(FIELDS)).toEqual(FIELDS);
    expect(mask.note('Synthetic note.')).toBe('Synthetic note.');
    expect(mask.ipAddress('192.0.2.10')).toBe('192.0.2.10');
    expect(mask.userAgent('SyntheticAgent/1.0')).toBe('SyntheticAgent/1.0');
  });

  it('replaces each field value with null but keeps the keys for a user without pii:view', () => {
    const mask = piiMaskFor(viewer);

    expect(mask.visible).toBe(false);
    expect(mask.fields(FIELDS)).toEqual({
      name_first: null,
      birth_year: null,
      is_test: null,
      nickname: null,
    });
    expect(FIELDS.name_first).toBe('Synthetic');
  });

  it('replaces the note, IP address and user agent with null for a user without pii:view', () => {
    const mask = piiMaskFor(viewer);

    expect(mask.note('Synthetic note.')).toBeNull();
    expect(mask.ipAddress('192.0.2.10')).toBeNull();
    expect(mask.userAgent('SyntheticAgent/1.0')).toBeNull();
  });

  it('keeps absent values absent', () => {
    for (const mask of [piiMaskFor(reviewer), piiMaskFor(viewer)]) {
      expect(mask.fields(null)).toBeNull();
      expect(mask.note(null)).toBeNull();
      expect(mask.ipAddress(null)).toBeNull();
      expect(mask.userAgent(null)).toBeNull();
    }
  });

  it('masks the C15 attributes of a resource and nothing else', () => {
    const attributes = {
      status: 'approved',
      'reference-id': 'ref-synthetic-1',
      fields: { name_first: 'Synthetic' },
      note: 'Synthetic note.',
      'ip-address': '192.0.2.10',
      'user-agent': 'SyntheticAgent/1.0',
    };

    expect(piiMaskFor(viewer).attributes(attributes)).toEqual({
      status: 'approved',
      'reference-id': 'ref-synthetic-1',
      fields: { name_first: null },
      note: null,
      'ip-address': null,
      'user-agent': null,
    });
    expect(piiMaskFor(reviewer).attributes(attributes)).toEqual(attributes);
  });

  it('never adds attributes a resource does not have', () => {
    const masked = piiMaskFor(viewer).attributes({ status: 'created', fields: null });

    expect(masked).toEqual({ status: 'created', fields: null });
    expect(masked).not.toHaveProperty('note');
  });
});

describe('extraction attributes of a government ID (C31.6)', () => {
  // A fictional holder; every value is synthetic.
  const attributes = {
    status: 'passed',
    country: null,
    'id-class': 'national_id',
    'name-first': 'QUINN',
    'name-last': 'VALEMONT',
    birthdate: '1990-02-14',
    'identification-number': 'X12K45P78',
    'address-street-1': '12 LANTERN ROW',
    'vehicle-class': null,
    'extraction-sources': { birthdate: ['mrz', 'viz'] },
  };

  it('are hidden from a pii-masked API key and a user without pii:view', () => {
    const expected = {
      status: 'passed',
      country: null,
      'id-class': 'national_id',
      'name-first': null,
      'name-last': null,
      birthdate: null,
      'identification-number': null,
      'address-street-1': null,
      'vehicle-class': null,
      // Field names only, never values: not PII.
      'extraction-sources': { birthdate: ['mrz', 'viz'] },
    };
    expect(piiMaskFor({ ...apiKey(PERMISSIONS), piiMasked: true }).attributes(attributes)).toEqual(
      expected,
    );
    expect(piiMaskFor(viewer).attributes(attributes)).toEqual(expected);
  });

  it('pass unchanged to a principal that may see PII, and to server-side copies', () => {
    expect(piiMaskFor(apiKey()).attributes(attributes)).toEqual(attributes);
    expect(piiMaskFor(reviewer).attributes(attributes)).toEqual(attributes);
    expect(UNMASKED.attributes(attributes)).toEqual(attributes);
  });
});

describe('UNMASKED', () => {
  it('is the mask of server-side copies (events, webhooks, jobs): it hides nothing', () => {
    expect(UNMASKED.visible).toBe(true);
    expect(UNMASKED.fields(FIELDS)).toEqual(FIELDS);
    expect(UNMASKED.note('Synthetic note.')).toBe('Synthetic note.');
  });
});

describe('requirePiiView', () => {
  it('allows API keys and users with pii:view', () => {
    expect(() => {
      requirePiiView(apiKey());
    }).not.toThrow();
    expect(() => {
      requirePiiView(reviewer);
    }).not.toThrow();
  });

  it('answers 403 forbidden naming pii:view for a user without it (file content, C15)', () => {
    let thrown: unknown;
    try {
      requirePiiView(viewer);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PermissionDeniedError);
    expect(thrown).toMatchObject({
      status: 403,
      type: 'https://openverify.dev/problems/forbidden',
      message: 'The user is missing the required permission: pii:view.',
    });
  });
});

describe('Phase 5 verification attributes (C53.7)', () => {
  // One synthetic value per PII attribute any resource marks, plus non-PII Phase 5 attributes.
  const pii = (): Record<string, unknown> => ({
    ...Object.fromEntries(PII_VERIFICATION_ATTRIBUTES.map((name) => [name, `synthetic-${name}`])),
    fields: { name: 'Synthetic Person', 'issue-date': '2026-09-01' },
    'associated-persons': [{ 'name-first': 'Synthetic', 'name-last': 'Officer' }],
  });
  const NOT_PII = {
    status: 'passed',
    'confirmed-at': '2026-10-20T12:00:00.000Z',
    sends: 2,
    'chain-id': 'eip155:1',
    'registry-source': 'gleif',
    'passive-authentication': { outcome: 'passed', integrity: 'established' },
  };

  it('names every attribute the contracts mark PII in the masked list', () => {
    expect([...MASKED_ATTRIBUTES]).toEqual(
      expect.arrayContaining([...PII_VERIFICATION_ATTRIBUTES]),
    );
  });

  it('hides each of them from a user without pii:view, fields member-wise, and nothing else', () => {
    const masked: Record<string, unknown> = piiMaskFor(viewer).attributes({ ...pii(), ...NOT_PII });

    for (const name of PII_VERIFICATION_ATTRIBUTES.filter((name) => name !== 'fields')) {
      expect(masked[name], name).toBeNull();
    }
    expect(masked.fields).toEqual({ name: null, 'issue-date': null });
    expect(masked).toMatchObject(NOT_PII);
  });

  it('passes them to a principal that may see PII', () => {
    const attributes = { ...pii(), ...NOT_PII };

    expect(piiMaskFor(reviewer).attributes(attributes)).toEqual(attributes);
  });
});

describe('one masked list for every exit and the run taint (Workflow 8C review K8-11)', () => {
  it('is the same list in the API and in the workflow engine', () => {
    expect([...MASKED_ATTRIBUTE_NAMES].sort()).toEqual([...MASKED_ATTRIBUTES].sort());
  });
});
