// @vitest-environment node
import { dashboardInviteUserBodySchema } from '@openverify/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { SESSION_COOKIE } from '../session-cookie';
import {
  ActionInputError,
  formString,
  formStrings,
  parseInput,
  runAction,
  type ActionResult,
} from './action';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const approve = (guard = {}) =>
  runAction(guard, async ({ api: client }) => {
    const { data } = await client.inquiries.approve('inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z');
    return data.id;
  });

describe('runAction', () => {
  it('returns { ok: true, data } when the work succeeds', async () => {
    api.reply(200, meDocument());

    await expect(runAction({}, () => Promise.resolve('done'))).resolves.toEqual({
      ok: true,
      data: 'done',
    });
  });

  it('refuses, without calling the API, when a permission is missing', async () => {
    api.reply(200, meDocument({ permissions: ['inquiries:read'] }));
    const work = vi.fn();

    const result = await runAction({ permissions: ['inquiries:write'] }, work);

    expect(result).toEqual({
      ok: false,
      problem: {
        title: 'You do not have access',
        detail: 'Your role does not allow this. Ask an administrator if you need it.',
      },
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("returns the API problem's title and detail, never a stack", async () => {
    api
      .reply(200, meDocument())
      .replyProblem(409, 'invalid-transition', { stack: 'Error\n    at internal.ts:1:1' });

    const result: ActionResult<string> = await approve();

    expect(result).toEqual({
      ok: false,
      problem: {
        title: 'Synthetic invalid-transition',
        detail: 'Synthetic detail for 409.',
        status: 409,
        requestId: 'req-synthetic-0001',
      },
    });
  });

  it("keeps the API's own title and detail for a 403 answered to an action (Workflow 2D K004)", async () => {
    api.reply(200, meDocument()).replyProblem(403, 'forbidden', {
      title: 'Forbidden',
      detail: 'You cannot grant permissions you do not hold: pii:view.',
    });

    await expect(approve()).resolves.toEqual({
      ok: false,
      problem: {
        title: 'Forbidden',
        detail: 'You cannot grant permissions you do not hold: pii:view.',
        status: 403,
        requestId: 'req-synthetic-0001',
      },
    });
  });

  it('sends a 401 to sign in', async () => {
    api.reply(200, meDocument()).replyProblem(401);

    await expect(redirectTarget(approve())).resolves.toBe('/login');
  });

  it('sends a 401 mfa-required to the security page', async () => {
    api.reply(200, meDocument()).replyProblem(401, 'mfa-required');

    await expect(redirectTarget(approve())).resolves.toBe('/account/security');
  });

  it('sends a session that has not satisfied required MFA to the security page', async () => {
    api.reply(200, meDocument({ mfaSatisfied: false }));

    await expect(redirectTarget(runAction({}, () => Promise.resolve(1)))).resolves.toBe(
      '/account/security',
    );
  });

  it('runs for such a session when the action allows it (MFA enrolment)', async () => {
    api.reply(200, meDocument({ mfaSatisfied: false }));

    await expect(runAction({ allowWithoutMfa: true }, () => Promise.resolve(1))).resolves.toEqual({
      ok: true,
      data: 1,
    });
  });

  it('says the API is unreachable when it is', async () => {
    api.reply(200, meDocument()).fail();

    await expect(approve()).resolves.toEqual({
      ok: false,
      problem: { title: 'The API could not be reached', detail: 'Try again in a moment.' },
    });
  });

  it('lets a programming error reach the error boundary', async () => {
    api.reply(200, meDocument());
    const bug = new Error('bug');

    await expect(runAction({}, () => Promise.reject(bug))).rejects.toBe(bug);
  });

  it('returns the field errors of input that fails its contract schema', async () => {
    api.reply(200, meDocument());

    const result = await runAction({}, () =>
      Promise.resolve(parseInput(dashboardInviteUserBodySchema, { email: 'nope', 'role-ids': [] })),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { title: 'Check the values you entered', detail: 'Some values are not valid.' },
    });
    const errors = result.ok ? [] : (result.problem.errors ?? []);
    expect(errors.map((error) => error.pointer)).toEqual(['/email', '/role-ids']);
    expect(errors.every((error) => error.detail !== '')).toBe(true);
    expect(api.requests).toHaveLength(1);
  });
});

describe('parseInput', () => {
  it('returns the parsed input', () => {
    expect(
      parseInput(dashboardInviteUserBodySchema, {
        email: 'invitee@example.test',
        'role-ids': ['role_01J9ZK3M5Q7R8S9T0V1W2X3Y53'],
      }),
    ).toEqual({ email: 'invitee@example.test', 'role-ids': ['role_01J9ZK3M5Q7R8S9T0V1W2X3Y53'] });
  });

  it('throws ActionInputError with a pointer per issue', () => {
    expect(() => parseInput(dashboardInviteUserBodySchema, {})).toThrow(ActionInputError);
  });
});

describe('form readers', () => {
  const form = new FormData();
  form.set('name', '  Synthetic  ');
  form.set('empty', '');
  form.append('tag', 'a');
  form.append('tag', 'b');
  form.set('file', new Blob(['x']));

  it('formString reads one text value, trimmed unless told otherwise', () => {
    expect(formString(form, 'name')).toBe('Synthetic');
    expect(formString(form, 'name', { trim: false })).toBe('  Synthetic  ');
    expect(formString(form, 'empty')).toBe('');
    expect(formString(form, 'missing')).toBeUndefined();
    expect(formString(form, 'file')).toBeUndefined();
  });

  it('formStrings reads every text value of a repeated field', () => {
    expect(formStrings(form, 'tag')).toEqual(['a', 'b']);
    expect(formStrings(form, 'missing')).toEqual([]);
  });
});

describe('runAction for a form of one environment (Workflow 2D F002)', () => {
  const ENVIRONMENT_CHANGED = {
    title: 'The environment changed',
    detail:
      'You switched environment after this page was opened, so nothing was saved. Reload the page and try again.',
  };
  const formOf = (environmentId?: string) => {
    const data = new FormData();
    if (environmentId !== undefined) {
      data.set('environment-id', environmentId);
    }
    return data;
  };

  it('refuses, without calling the API, a form rendered for another environment', async () => {
    api.reply(200, meDocument({ environment: ENVIRONMENTS.production }));
    const work = vi.fn();

    const result = await runAction({ environmentForm: formOf(ENVIRONMENTS.sandbox.id) }, work);

    expect(result).toEqual({ ok: false, problem: ENVIRONMENT_CHANGED });
    expect(work).not.toHaveBeenCalled();
    expect(api.requests.map(({ path }) => path)).toEqual(['/api/v1/dashboard/me']);
  });

  it('refuses a form that does not say which environment it was rendered for', async () => {
    api.reply(200, meDocument());
    const work = vi.fn();

    await expect(runAction({ environmentForm: formOf() }, work)).resolves.toEqual({
      ok: false,
      problem: ENVIRONMENT_CHANGED,
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("runs when the form was rendered for the session's environment", async () => {
    api.reply(200, meDocument({ environment: ENVIRONMENTS.production }));

    await expect(
      runAction({ environmentForm: formOf(ENVIRONMENTS.production.id) }, () =>
        Promise.resolve('saved'),
      ),
    ).resolves.toEqual({ ok: true, data: 'saved' });
  });
});
