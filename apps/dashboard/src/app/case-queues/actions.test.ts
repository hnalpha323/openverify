// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_PROBLEM_WORDS } from '../../components/cases/case-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { CASE_IDS, assignmentPolicy, caseQueue } from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { CASE_DEVELOPER, CASE_REVIEWER } from '../../testing/routes/cases';
import {
  archiveCaseQueue,
  createAssignmentPolicy,
  createCaseQueue,
  setCaseQueueMembers,
  updateAssignmentPolicy,
  updateCaseQueue,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const QUEUE = `/case-queues/${CASE_IDS.queue}`;
const POLICY = `/case-assignment-policies/${CASE_IDS.policy}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_DEVELOPER });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string | readonly string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      data.append(name, each);
    }
  }
  return data;
};
const environment = { 'environment-id': ENVIRONMENTS.sandbox.id };

describe('queue actions (C132.1, C142.1)', () => {
  it('creates a queue by name and answers its id', async () => {
    api.on('POST', '/case-queues', 201, { data: caseQueue({ members: [] }) });

    expect(await createCaseQueue(null, form({ ...environment, name: ' Synthetic ' }))).toEqual({
      ok: true,
      data: { id: CASE_IDS.queue },
    });
    expect(api.find('POST', '/case-queues')?.body).toEqual({
      data: { type: 'case-queue', attributes: { name: 'Synthetic' } },
    });
  });

  it('renames a queue and names its policy, or none', async () => {
    api.on('PATCH', QUEUE, 200, { data: caseQueue() });

    await updateCaseQueue(
      null,
      form({ 'case-queue-id': CASE_IDS.queue, name: 'Renamed', 'case-assignment-policy-id': '' }),
    );

    expect(api.find('PATCH', QUEUE)?.body).toEqual({
      data: {
        type: 'case-queue',
        attributes: { name: 'Renamed', 'case-assignment-policy-id': null },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(QUEUE);
  });

  it('archives a queue by its status', async () => {
    api.on('PATCH', QUEUE, 200, { data: caseQueue({ status: 'archived' }) });

    expect((await archiveCaseQueue(null, form({ 'case-queue-id': CASE_IDS.queue }))).ok).toBe(true);
    expect(api.find('PATCH', QUEUE)?.body).toEqual({
      data: { type: 'case-queue', attributes: { status: 'archived' } },
    });
  });

  it('replaces the members, row by row, each with its capacity and pause', async () => {
    api.on('PUT', `${QUEUE}/members`, 200, { data: caseQueue() });

    const result = await setCaseQueueMembers(
      null,
      form({
        'case-queue-id': CASE_IDS.queue,
        'member-user-id': [CASE_IDS.user, ` ${CASE_IDS.member} `],
        'member-max-open': ['50', '10'],
        'member-paused': ['false', 'true'],
      }),
    );

    expect(result.ok).toBe(true);
    expect(api.find('PUT', `${QUEUE}/members`)?.body).toEqual({
      data: {
        type: 'case-queue',
        attributes: {
          members: [
            { 'user-id': CASE_IDS.user, 'max-open': 50, paused: false },
            { 'user-id': CASE_IDS.member, 'max-open': 10, paused: true },
          ],
        },
      },
    });
  });

  it('says why a member is refused, at the member’s place, and refuses a malformed row without asking', async () => {
    api.onProblem('PUT', `${QUEUE}/members`, 422, undefined, {
      code: 'case_assignee_ineligible',
      errors: [{ pointer: '/data/attributes/members/1/user-id', detail: 'Not eligible.' }],
    });
    const refused = await setCaseQueueMembers(
      null,
      form({
        'case-queue-id': CASE_IDS.queue,
        'member-user-id': [CASE_IDS.user, CASE_IDS.member],
        'member-max-open': ['50', '50'],
        'member-paused': ['false', 'false'],
      }),
    );
    expect(refused).toMatchObject({
      ok: false,
      problem: {
        title: CASE_PROBLEM_WORDS.case_assignee_ineligible,
        errors: [{ pointer: '/data/attributes/members/1/user-id' }],
      },
    });

    const malformed = await setCaseQueueMembers(
      null,
      form({
        'case-queue-id': CASE_IDS.queue,
        'member-user-id': ['someone'],
        'member-max-open': ['900'],
        'member-paused': ['false'],
      }),
    );
    expect(malformed).toMatchObject({
      ok: false,
      problem: {
        errors: [
          { pointer: '/data/attributes/members/0/user-id' },
          { pointer: '/data/attributes/members/0/max-open' },
        ],
      },
    });
    expect(api.all('PUT', `${QUEUE}/members`)).toHaveLength(1);
  });

  it('asks nothing without case-queues:write', async () => {
    api.me({ permissions: CASE_REVIEWER });

    expect(
      await setCaseQueueMembers(null, form({ 'case-queue-id': CASE_IDS.queue })),
    ).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });
});

describe('assignment policy actions (C132.2, C142.1)', () => {
  const policyForm = (overrides: Record<string, string> = {}) =>
    form({
      ...environment,
      name: 'Synthetic round robin',
      distribution: 'round-robin',
      sort: 'sla-expires-at',
      agents: '',
      'max-capacity': '20',
      sources: `${CASE_IDS.queue}\n${CASE_IDS.template}\n`,
      ...overrides,
    });

  it('creates a policy: no agents for the queue’s members, sources in order by their prefix', async () => {
    api.on('POST', '/case-assignment-policies', 201, { data: assignmentPolicy() });

    expect(await createAssignmentPolicy(null, policyForm())).toEqual({
      ok: true,
      data: { id: CASE_IDS.policy },
    });
    expect(api.find('POST', '/case-assignment-policies')?.body).toEqual({
      data: {
        type: 'case-assignment-policy',
        attributes: {
          name: 'Synthetic round robin',
          distribution: 'round-robin',
          sort: 'sla-expires-at',
          agents: null,
          'max-capacity': 20,
          sources: [
            { type: 'case-queue', id: CASE_IDS.queue },
            { type: 'case-template', id: CASE_IDS.template },
          ],
        },
      },
    });
  });

  it('updates a policy with named agents and each member’s own limit', async () => {
    api.on('PATCH', POLICY, 200, { data: assignmentPolicy() });

    const result = await updateAssignmentPolicy(
      null,
      policyForm({
        'case-assignment-policy-id': CASE_IDS.policy,
        agents: `${CASE_IDS.member}, ${CASE_IDS.user}`,
        'max-capacity': '',
        distribution: 'fewest-open',
      }),
    );

    expect(result.ok).toBe(true);
    expect(api.find('PATCH', POLICY)?.body).toMatchObject({
      data: {
        attributes: {
          distribution: 'fewest-open',
          agents: [CASE_IDS.member, CASE_IDS.user],
          'max-capacity': null,
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/case-queues/policies/${CASE_IDS.policy}`);
  });

  it('refuses a source that is neither a template nor a queue at its place', async () => {
    const result = await createAssignmentPolicy(
      null,
      policyForm({ sources: `${CASE_IDS.queue}\n${CASE_IDS.account}` }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/data/attributes/sources/1',
            detail: 'Name a case template (ctmpl_…) or a queue (cqueue_…).',
          },
        ],
      },
    });
    expect(api.find('POST', '/case-assignment-policies')).toBeUndefined();
  });
});
