import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, IDS } from './test-support.js';
import {
  AUDIT_ACTOR_TYPES,
  auditActionSchema,
  buildUserAuditLogResource,
  listUserAuditLogsQuerySchema,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
  userAuditLogResourceSchema,
} from './user-audit-logs.js';

const entry = {
  type: 'user-audit-log',
  id: IDS.userAuditLog,
  attributes: {
    action: 'inquiry.approved',
    actor: { type: 'user', id: IDS.user },
    'resource-type': 'inquiry',
    'resource-id': IDS.inquiry,
    'ip-address': '203.0.113.7',
    'user-agent': 'Mozilla/5.0 (synthetic test agent)',
    metadata: { from: 'needs_review', to: 'approved' },
    'created-at': AT_ISO,
  },
};

describe('an entry no principal wrote (owner decisions 3 after 7A and 5 after 7B)', () => {
  const system = {
    ...entry,
    attributes: { ...entry.attributes, actor: { type: 'system', id: null } },
  };

  it('is served with the system actor, which names no id', () => {
    expect(userAuditLogResourceSchema.parse(system)).toEqual(system);
  });

  it('names a workflow run as its own kind of actor, by its wfr_ id (C121.1)', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    const value = {
      ...entry,
      attributes: { ...entry.attributes, actor: { type: 'workflow-run', id: run } },
    };
    expect(userAuditLogResourceSchema.parse(value).attributes.actor).toEqual({
      type: 'workflow-run',
      id: run,
    });
    for (const actor of [
      { type: 'workflow-run', id: IDS.user },
      { type: 'workflow-run', id: null },
      { type: 'user', id: run },
    ]) {
      const refused = { ...entry, attributes: { ...entry.attributes, actor } };
      expect(userAuditLogResourceSchema.safeParse(refused).success).toBe(false);
    }
  });

  it('filters by a workflow run as an actor (C121.1)', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    expect(listUserAuditLogsQuerySchema.safeParse({ 'filter[actor-id]': run }).success).toBe(true);
  });

  it('refuses a system actor with an id, and a user or an API key without one', () => {
    for (const actor of [
      { type: 'system', id: IDS.user },
      { type: 'user', id: null },
      { type: 'api-key', id: null },
    ]) {
      const value = { ...entry, attributes: { ...entry.attributes, actor } };
      expect(userAuditLogResourceSchema.safeParse(value).success).toBe(false);
    }
  });

  it('is built from a record with the system actor', () => {
    const { attributes } = buildUserAuditLogResource({
      id: entry.id,
      action: 'handoff.redeemed',
      actor: { type: 'system', id: null },
      resourceType: 'inquiry',
      resourceId: IDS.inquiry,
      ipAddress: null,
      userAgent: null,
      metadata: {},
      createdAt: AT,
    });

    expect(attributes.actor).toEqual({ type: 'system', id: null });
  });
});

describe('user-audit-log resource (C15)', () => {
  it('records who did what to which resource', () => {
    expect(AUDIT_ACTOR_TYPES).toEqual(['user', 'api-key', 'system', 'workflow-run']);
    expect(userAuditLogResourceSchema.parse(entry)).toEqual(entry);
    expect(userAuditLogDocumentSchema.safeParse({ data: entry }).success).toBe(true);
    expect(
      userAuditLogListDocumentSchema.safeParse({ data: [entry], links: { next: null } }).success,
    ).toBe(true);
  });

  it('records actions without a resource, by an API key, with a masked caller', () => {
    const value = {
      ...entry,
      attributes: {
        ...entry.attributes,
        action: 'webhook.secret-rotated',
        actor: { type: 'api-key', id: IDS.serverIntegration },
        'resource-type': null,
        'resource-id': null,
        'ip-address': null,
        'user-agent': null,
        metadata: {},
      },
    };
    expect(userAuditLogResourceSchema.safeParse(value).success).toBe(true);
  });

  it.each(['inquiry.approved', 'file.viewed', 'webhook.secret-rotated', 'user.mfa.enrolled'])(
    'accepts the dotted action %s',
    (action) => {
      expect(auditActionSchema.safeParse(action).success).toBe(true);
    },
  );

  it.each([
    'approved',
    'Inquiry.Approved',
    'inquiry.',
    'inquiry approved',
    'inquiry.marked_for_review',
  ])('rejects the action %j', (action) => {
    expect(auditActionSchema.safeParse(action).success).toBe(false);
  });

  it.each([
    ['a user actor with an API key id', { type: 'user', id: IDS.serverIntegration }],
    ['an API key actor with a user id', { type: 'api-key', id: IDS.user }],
    ['an unknown actor type', { type: 'system', id: IDS.user }],
  ])('rejects %s', (_name, actor) => {
    const value = { ...entry, attributes: { ...entry.attributes, actor } };
    expect(userAuditLogResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from a record', () => {
    expect(
      buildUserAuditLogResource({
        id: IDS.userAuditLog,
        action: 'inquiry.approved',
        actor: { type: 'user', id: IDS.user },
        resourceType: 'inquiry',
        resourceId: IDS.inquiry,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (synthetic test agent)',
        metadata: { from: 'needs_review', to: 'approved' },
        createdAt: AT,
      }),
    ).toEqual(entry);
  });
});

describe('GET /user-audit-logs query (C15)', () => {
  it('filters by action, actor, resource and time', () => {
    const query = {
      'filter[action]': 'inquiry.approved,file.viewed',
      'filter[actor-id]': `${IDS.user},${IDS.serverIntegration}`,
      'filter[resource-type]': 'inquiry',
      'filter[resource-id]': IDS.inquiry,
      'filter[created-at-end]': '2026-11-01T00:00:00Z',
    };
    expect(listUserAuditLogsQuerySchema.parse(query)).toEqual(query);
    expect(
      listUserAuditLogsQuerySchema.safeParse({ 'filter[actor-id]': IDS.inquiry }).success,
    ).toBe(false);
  });
});
