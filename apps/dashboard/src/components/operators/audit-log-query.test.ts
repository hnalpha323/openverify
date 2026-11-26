import { describe, expect, it } from 'vitest';
import { auditLogFilterQuery, parseAuditLogQuery } from './audit-log-query';
import { API_KEY_ID, AUDIT_IDS, INQUIRY_ID, USER_IDS } from './test-fixtures';

describe('parseAuditLogQuery', () => {
  it('reads no filter from an empty URL', () => {
    expect(parseAuditLogQuery({})).toEqual({ filters: {}, api: {}, errors: {} });
  });

  it('turns the URL filters into the API query: dates as a UTC range with an inclusive last day', () => {
    const query = parseAuditLogQuery({
      action: ' inquiry.approved,user.invited ',
      actor: `${USER_IDS.admin},${API_KEY_ID}`,
      'resource-type': 'inquiry',
      'resource-id': INQUIRY_ID,
      from: '2026-10-01',
      to: '2026-10-20',
      after: AUDIT_IDS.second,
    });

    expect(query).toEqual({
      filters: {
        action: 'inquiry.approved,user.invited',
        actor: `${USER_IDS.admin},${API_KEY_ID}`,
        resourceType: 'inquiry',
        resourceId: INQUIRY_ID,
        from: '2026-10-01',
        to: '2026-10-20',
      },
      api: {
        action: 'inquiry.approved,user.invited',
        actorId: `${USER_IDS.admin},${API_KEY_ID}`,
        resourceType: 'inquiry',
        resourceId: INQUIRY_ID,
        createdAtStart: '2026-10-01T00:00:00.000Z',
        createdAtEnd: '2026-10-21T00:00:00.000Z',
        after: AUDIT_IDS.second,
      },
      errors: {},
    });
  });

  it('takes a workflow run as an actor, the link every run entry carries (C121.1)', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    const query = parseAuditLogQuery({ actor: run });

    expect(query.errors).toEqual({});
    expect(query.api).toEqual({ actorId: run });
  });

  it('explains each filter it cannot use, in plain words', () => {
    const query = parseAuditLogQuery({
      action: 'Approved!',
      actor: 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y91',
      'resource-type': 'x'.repeat(65),
      'resource-id': 'not-an-id',
      from: '2026-02-30',
      to: 'yesterday',
    });

    expect(query.errors).toEqual({
      action: 'Enter actions such as inquiry.approved, separated by commas.',
      actor: 'Enter user, API key or workflow run IDs (usr_…, key_…, wfr_…), separated by commas.',
      resourceType: 'Enter a resource type of at most 64 characters, such as inquiry.',
      resourceId: 'Enter IDs such as inq_…, separated by commas.',
      from: 'Enter a date.',
      to: 'Enter a date.',
    });
    expect(query.filters.action).toBe('Approved!');
  });

  it('refuses a range that ends before it starts', () => {
    expect(parseAuditLogQuery({ from: '2026-10-20', to: '2026-10-01' }).errors).toEqual({
      to: 'Enter a date on or after the start date.',
    });
  });

  it('accepts a one-day range and an open range', () => {
    expect(parseAuditLogQuery({ from: '2026-10-20', to: '2026-10-20' }).api).toEqual({
      createdAtStart: '2026-10-20T00:00:00.000Z',
      createdAtEnd: '2026-10-21T00:00:00.000Z',
    });
    expect(parseAuditLogQuery({ to: '2026-12-31' }).api).toEqual({
      createdAtEnd: '2027-01-01T00:00:00.000Z',
    });
  });

  it('ignores a malformed cursor, repeated values and unknown parameters', () => {
    expect(parseAuditLogQuery({ after: 'aud_bad', action: ['a.b', 'c.d'], status: 'x' })).toEqual({
      filters: {},
      api: {},
      errors: {},
    });
  });
});

describe('parseAuditLogQuery: Workflow 9C (C168.6)', () => {
  it('reads the action prefix, every action starting with it', () => {
    const query = parseAuditLogQuery({ 'action-prefix': ' settings. ' });

    expect(query).toEqual({
      filters: { actionPrefix: 'settings.' },
      api: { actionPrefix: 'settings.' },
      errors: {},
    });
  });

  it.each(['Settings', '.inquiry', 'inquiry approved', 'x'.repeat(65)])(
    'explains the prefix %j, which no action name starts with',
    (prefix) => {
      expect(parseAuditLogQuery({ 'action-prefix': prefix }).errors).toEqual({
        actionPrefix:
          'Enter the start of an action name in lower case, such as settings. or inquiry.',
      });
    },
  );

  it('never reads an IP address from the URL: the address filter is posted, never linked (rule 11)', () => {
    expect(parseAuditLogQuery({ ip: '203.0.113.9', 'filter[ip]': '203.0.113.9' })).toEqual({
      filters: {},
      api: {},
      errors: {},
    });
  });
});

describe('auditLogFilterQuery', () => {
  it('names the URL parameters of the filters, for links that keep them', () => {
    expect(
      auditLogFilterQuery({ action: 'user.invited', resourceId: INQUIRY_ID, from: '2026-10-01' }),
    ).toEqual({
      action: 'user.invited',
      actor: undefined,
      'resource-type': undefined,
      'resource-id': INQUIRY_ID,
      'action-prefix': undefined,
      from: '2026-10-01',
      to: undefined,
    });
  });
});
