// @vitest-environment node
import { EVENT_NAMES } from '@openverify/contracts';
import { createClient } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, mockApi, type MockApi } from '../../testing/api-mock';
import { eventNameGroups, listEvents, parseEventListQuery } from './events';

const EVENT = 'evt_01J9ZK3M5Q7R8S9T0V1W2X3Y61';
const INQUIRY = 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('parseEventListQuery', () => {
  it('reads the name, object, simulated flag, creation range and cursor', () => {
    expect(
      parseEventListQuery({
        name: 'inquiry.approved',
        'object-id': INQUIRY,
        simulated: 'true',
        'created-at-start': '2026-10-20T10:00',
        'created-at-end': '2026-10-21T10:00',
        after: EVENT,
      }),
    ).toEqual({
      values: {
        name: 'inquiry.approved',
        'object-id': INQUIRY,
        simulated: 'true',
        'created-at-start': '2026-10-20T10:00',
        'created-at-end': '2026-10-21T10:00',
      },
      applied: {
        name: 'inquiry.approved',
        'object-id': INQUIRY,
        simulated: 'true',
        'created-at-start': '2026-10-20T10:00:00.000Z',
        'created-at-end': '2026-10-21T10:00:00.000Z',
      },
      errors: {},
      after: EVENT,
    });
  });

  it('applies nothing malformed, and says why', () => {
    const query = parseEventListQuery({
      name: 'inquiry.exploded',
      'object-id': 'someone',
      simulated: 'maybe',
    });

    expect(query.applied).toEqual({});
    expect(query.errors).toEqual({
      name: 'Choose an event from the list.',
      'object-id': 'Enter an object ID, such as inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
      simulated: 'Choose from the list.',
    });
  });
});

describe('listEvents', () => {
  it('lists one page with the filters, simulated events only on request', async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listEvents(
      client,
      parseEventListQuery({
        name: 'inquiry.approved',
        'object-id': INQUIRY,
        simulated: 'true',
        'created-at-start': '2026-10-20T10:00',
        after: EVENT,
      }),
    );

    expect(api.last().path).toBe('/api/v1/events');
    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[name]': 'inquiry.approved',
      'filter[object-id]': INQUIRY,
      'filter[simulated]': 'true',
      'filter[created-at-start]': '2026-10-20T10:00:00.000Z',
      'page[size]': '25',
      'page[after]': EVENT,
    });
  });

  it('sends no filter when none is applied', async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listEvents(client, parseEventListQuery({}));

    expect(Object.fromEntries(api.last().query)).toEqual({ 'page[size]': '25' });
  });
});

describe('eventNameGroups', () => {
  it('groups every event name by its subject, in catalog order', () => {
    const groups = eventNameGroups();

    expect(groups.map((group) => group.label)).toEqual([
      'Inquiry',
      'Inquiry session',
      'Verification',
      'Account',
      'Selfie',
      'Report',
      'List matches',
      'Transactions',
      'Transaction types',
      'Graph queries',
      'Workflows',
      'Workflow runs',
      'Lists',
      'Cases',
      'Case comments',
      // C154.8 (Workflow 9A).
      'Inquiry templates',
      'Deployments',
      // C239.3 (Workflow 11A): connections, share tokens and consent records, one group.
      'Connect',
    ]);
    expect(groups.flatMap((group) => group.names).toSorted()).toEqual([...EVENT_NAMES].toSorted());
    // C70.4 (Phase 6): one Report group, every type's events in registry order.
    expect(groups.find(({ label }) => label === 'Report')?.names[0]).toBe('report/watchlist.ready');
    expect(groups.find(({ label }) => label === 'List matches')?.names).toEqual([
      'list-match.created',
    ]);
    expect(groups[0]?.names[0]).toBe('inquiry.created');
    const connect = groups.find(({ label }) => label === 'Connect')?.names ?? [];
    expect(connect).toHaveLength(16);
    expect(connect[0]).toBe('connect/connection.created');
    expect(connect).toContain('connect/share-token.inbound-created');
    expect(connect).toContain('consent-record.withdrawn');
  });
});
