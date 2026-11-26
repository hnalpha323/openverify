import { describe, expect, it } from 'vitest';
import { readFixture, AT, LATER } from './test-support.js';
import {
  buildWorkflowSecretResource,
  createWorkflowSecretBodySchema,
  hasSecretReference,
  listWorkflowSecretsQuerySchema,
  normalizeSecretReference,
  putWorkflowSecretValueBodySchema,
  rotateWorkflowSecretValueBodySchema,
  secretKeysOf,
  updateWorkflowSecretBodySchema,
  workflowSecretDocumentSchema,
  workflowSecretKeySchema,
  workflowSecretListDocumentSchema,
  workflowSecretReferenceSchema,
  workflowSecretResourceSchema,
  type WorkflowSecretRecord,
} from './workflow-secrets.js';

const ID = 'wsec_01M5CM00000000000000000030';
const ENVIRONMENT = 'env_01M5CM00000000000000000005';
const USER = 'usr_01M5CJZC30W7PFE0GD30HJWEC6';

const RECORD: WorkflowSecretRecord = {
  id: ID,
  key: 'partner_token',
  description: 'The partner API',
  allowedHosts: ['api.example.com'],
  allowedPlacements: { headers: ['authorization'], 'body-pointers': [] },
  createdBy: USER,
  value: {
    environmentId: ENVIRONMENT,
    last4: 'abcd',
    version: 2,
    rotatedBy: USER,
    rotatedAt: LATER,
    previousExpiresAt: null,
  },
  createdAt: AT,
  updatedAt: LATER,
};

const attributesOf = (record: WorkflowSecretRecord) =>
  (buildWorkflowSecretResource(record) as { attributes: Record<string, unknown> }).attributes;

describe('a workflow secret (C125.1, C125.2)', () => {
  it('builds metadata alone, and validates it', () => {
    const resource = buildWorkflowSecretResource(RECORD);
    expect(workflowSecretResourceSchema.parse(resource)).toEqual(resource);
    expect(attributesOf(RECORD)).toMatchObject({
      key: 'partner_token',
      'allowed-hosts': ['api.example.com'],
      'allowed-placements': { headers: ['authorization'], 'body-pointers': [] },
      'environment-value': { 'environment-id': ENVIRONMENT, last4: 'abcd', version: 2 },
    });
  });

  it('never has a member that could hold a value (C125.5)', () => {
    const value = attributesOf(RECORD)['environment-value'] as object;
    for (const member of ['secret-value', 'value-sealed', 'previous-value']) {
      expect(Object.keys(attributesOf(RECORD))).not.toContain(member);
      expect(Object.keys(value)).not.toContain(member);
    }
  });

  it('reads no value in this environment as null', () => {
    expect(attributesOf({ ...RECORD, value: null })['environment-value']).toBeNull();
  });

  it('parses the golden secret and list', () => {
    expect(
      workflowSecretDocumentSchema.safeParse(readFixture('api/workflow-secret.json')).success,
    ).toBe(true);
    expect(
      workflowSecretListDocumentSchema.safeParse({
        data: [(readFixture('api/workflow-secret.json') as { data: unknown }).data],
        links: { next: null },
      }).success,
    ).toBe(true);
  });

  it('pages by id', () => {
    expect(listWorkflowSecretsQuerySchema.safeParse({ 'page[size]': '10' }).success).toBe(true);
  });
});

describe('the key (C125.1)', () => {
  it.each(['partner_token', 'a', 'slack_url_1'])('takes %s', (key) => {
    expect(workflowSecretKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(['Partner', '1token', 'a-b', 'a.b', '', 'a'.repeat(65), '__proto__'])(
    'refuses %s',
    (key) => {
      expect(workflowSecretKeySchema.safeParse(key).success).toBe(false);
    },
  );
});

describe('the bodies (C125.2)', () => {
  const attributes = { key: 'partner_token', 'allowed-hosts': ['api.example.com'] };
  const create = (value: object) =>
    createWorkflowSecretBodySchema.safeParse({
      data: { type: 'workflow-secret', attributes: value },
    }).success;

  it('creates with a key and hosts, and placements default on the server', () => {
    expect(create(attributes)).toBe(true);
    expect(create({ ...attributes, description: 'Partner' })).toBe(true);
    expect(
      create({
        ...attributes,
        'allowed-placements': { headers: ['x-api-key'], 'body-pointers': ['/token'] },
      }),
    ).toBe(true);
  });

  it('needs at least one host: a secret bound to nothing can go nowhere', () => {
    expect(create({ key: 'a', 'allowed-hosts': [] })).toBe(false);
  });

  it.each([
    ['a scheme', 'https://api.example.com'],
    ['a port', 'api.example.com:8443'],
    ['a path', 'api.example.com/a'],
    ['an upper-case host', 'API.example.com'],
    ['a trailing dot', 'api.example.com.'],
  ])('refuses a host with %s: hosts are normalised before they are compared', (_name, host) => {
    expect(create({ key: 'a', 'allowed-hosts': [host] })).toBe(false);
  });

  it('refuses a header placement that is no header name, and a pointer that is no pointer', () => {
    expect(
      create({
        ...attributes,
        'allowed-placements': { headers: ['bad header'], 'body-pointers': [] },
      }),
    ).toBe(false);
    expect(
      create({ ...attributes, 'allowed-placements': { headers: [], 'body-pointers': ['token'] } }),
    ).toBe(false);
  });

  it('never takes the value on the secret itself', () => {
    expect(create({ ...attributes, 'secret-value': 'x' })).toBe(false);
  });

  it('patches description, hosts and placements, never the key', () => {
    const patch = (value: object) =>
      updateWorkflowSecretBodySchema.safeParse({
        data: { type: 'workflow-secret', attributes: value },
      }).success;
    expect(patch({ description: 'x' })).toBe(true);
    expect(patch({ 'allowed-hosts': ['api.example.org'] })).toBe(true);
    expect(patch({ key: 'other' })).toBe(false);
    expect(patch({})).toBe(false);
  });

  it.each([
    ['put', putWorkflowSecretValueBodySchema],
    ['rotate', rotateWorkflowSecretValueBodySchema],
  ] as const)('%s takes secret-value, bounded', (_name, schema) => {
    const body = (value: unknown) => ({ data: { attributes: { 'secret-value': value } } });
    expect(schema.safeParse(body('change-me-canary')).success).toBe(true);
    expect(schema.safeParse(body('')).success).toBe(false);
    expect(schema.safeParse(body('x'.repeat(8193))).success).toBe(false);
    expect(schema.safeParse(body('line\nbreak')).success).toBe(false);
  });
});

describe('references (C125.3)', () => {
  it('takes the stored form', () => {
    expect(workflowSecretReferenceSchema.safeParse('{{secrets.partner_token}}').success).toBe(true);
    expect(workflowSecretReferenceSchema.safeParse('{{ secrets.partner_token }}').success).toBe(
      true,
    );
  });

  it('refuses anything that is not exactly one reference', () => {
    for (const text of [
      'partner_token',
      '{{secrets.a}}{{secrets.b}}',
      'x{{secrets.a}}',
      '{{vars.a}}',
    ]) {
      expect(workflowSecretReferenceSchema.safeParse(text).success, text).toBe(false);
    }
  });

  it('finds a reference inside a template, in either form', () => {
    expect(hasSecretReference('Bearer {{secrets.partner_token}}')).toBe(true);
    expect(hasSecretReference('{{current_run.environment.secrets.partner_token}}')).toBe(true);
    expect(hasSecretReference('{{ current_run.environment.secrets.partner_token }}')).toBe(true);
    expect(hasSecretReference('{{ vars.secrets }}')).toBe(false);
    expect(hasSecretReference('no template')).toBe(false);
  });

  it('stores the public form as ours', () => {
    expect(normalizeSecretReference('Bearer {{current_run.environment.secrets.a_b}}')).toBe(
      'Bearer {{secrets.a_b}}',
    );
    expect(normalizeSecretReference('{{ current_run.environment.secrets.a }}')).toBe(
      '{{secrets.a}}',
    );
    expect(normalizeSecretReference('{{ vars.a }}')).toBe('{{ vars.a }}');
  });

  it('lists the keys a template names, so publish can resolve them', () => {
    expect(secretKeysOf('{{secrets.a}} and {{ current_run.environment.secrets.b }}')).toEqual([
      'a',
      'b',
    ]);
    expect(secretKeysOf('{{ vars.a }}')).toEqual([]);
  });
});
