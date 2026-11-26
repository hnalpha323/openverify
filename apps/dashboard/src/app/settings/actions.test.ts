// @vitest-environment node
import {
  FACE_SEARCH_MAX_TEMPLATES,
  FACE_TEMPLATE_RETENTION_DAYS,
  OTP_SMS_MAX_PER_HOUR,
} from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { saveSettings } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  api.restore();
});

const admin = () => meDocument({ permissions: [...PERMISSIONS] });

/** The form as the settings page posts it; an unchecked checkbox sends nothing. */
function form(
  values: Partial<
    Record<
      | 'require-mfa'
      | 'inquiry'
      | 'api-log'
      | 'webhook-delivery'
      | 'event'
      | 'face-retention'
      | 'face-search',
      string
    >
  >,
): FormData {
  const data = new FormData();
  // The page renders the session environment's id (Workflow 2D F002); `meDocument` is sandbox.
  data.set('environment-id', ENVIRONMENTS.sandbox.id);
  if (values['require-mfa'] !== undefined) {
    data.set('require-mfa', values['require-mfa']);
  }
  data.set('inquiry-retention-days', values.inquiry ?? '');
  data.set('api-log-retention-days', values['api-log'] ?? '30');
  data.set('webhook-delivery-retention-days', values['webhook-delivery'] ?? '30');
  data.set('event-retention-days', values.event ?? '90');
  // C42.4, C42.6, C47: the face matching settings, at their defaults unless given.
  data.set('face-template-retention-days', values['face-retention'] ?? '365');
  data.set('face-search-max-templates', values['face-search'] ?? '50000');
  return data;
}

describe('saveSettings', () => {
  it('saves nothing when the session switched environment after the form was rendered (Workflow 2D F002)', async () => {
    api.reply(
      200,
      meDocument({ permissions: [...PERMISSIONS], environment: ENVIRONMENTS.production }),
    );

    const result = await saveSettings(null, form({ inquiry: '1' }));

    expect(result).toMatchObject({ ok: false, problem: { title: 'The environment changed' } });
    expect(api.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/dashboard/me',
    ]);
  });

  it('sends only the settings that changed', async () => {
    api
      .reply(200, admin())
      .reply(200, settings())
      .reply(200, settings({ 'require-mfa': true, 'inquiry-retention-days': 365 }));

    await expect(
      saveSettings(null, form({ 'require-mfa': 'true', inquiry: ' 365 ' })),
    ).resolves.toEqual({ ok: true, data: { changed: true } });
    expect(api.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/dashboard/me',
      'GET /api/v1/dashboard/settings',
      'PATCH /api/v1/dashboard/settings',
    ]);
    expect(api.last().body).toEqual({ 'require-mfa': true, 'inquiry-retention-days': 365 });
    expect(revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('sends the face template settings only when they changed (C42.6, C47)', async () => {
    api
      .reply(200, admin())
      .reply(
        200,
        settings({ 'face-template-retention-days': 30, 'face-search-max-templates': 1000 }),
      );

    await expect(
      saveSettings(null, form({ 'face-retention': '30', 'face-search': '1000' })),
    ).resolves.toEqual({ ok: true, data: { changed: false } });
    expect(api.requests.map(({ method }) => method)).toEqual(['GET', 'GET']);
  });

  it('saves a changed face template retention and search limit (C42.4, C42.6, C47)', async () => {
    api
      .reply(200, admin())
      .reply(200, settings())
      .reply(
        200,
        settings({ 'face-template-retention-days': 90, 'face-search-max-templates': 1000 }),
      );

    await expect(
      saveSettings(null, form({ 'face-retention': '90', 'face-search': ' 1000 ' })),
    ).resolves.toEqual({ ok: true, data: { changed: true } });
    expect(api.last().body).toEqual({
      'face-template-retention-days': 90,
      'face-search-max-templates': 1000,
    });
  });

  it.each([
    ['0', '50000', '/face-template-retention-days'],
    ['1096', '50000', '/face-template-retention-days'],
    ['30.5', '50000', '/face-template-retention-days'],
    ['', '50000', '/face-template-retention-days'],
    ['365', '999', '/face-search-max-templates'],
    ['365', '200001', '/face-search-max-templates'],
    ['365', 'many', '/face-search-max-templates'],
  ])(
    'refuses a face retention of "%s" days or a search limit of "%s" on its field, without calling the API',
    async (retention, search, pointer) => {
      api.reply(200, admin());

      const result = await saveSettings(
        null,
        form({ 'face-retention': retention, 'face-search': search }),
      );

      const range =
        pointer === '/face-template-retention-days'
          ? `days from ${FACE_TEMPLATE_RETENTION_DAYS.min.toLocaleString('en-US')} to ${FACE_TEMPLATE_RETENTION_DAYS.max.toLocaleString('en-US')}`
          : `templates from ${FACE_SEARCH_MAX_TEMPLATES.min.toLocaleString('en-US')} to ${FACE_SEARCH_MAX_TEMPLATES.max.toLocaleString('en-US')}`;
      expect(result).toEqual({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          detail: 'Some values are not valid.',
          errors: [{ pointer, detail: `Enter a whole number of ${range}.` }],
        },
      });
      expect(api.requests).toHaveLength(1);
    },
  );

  it('turns an empty inquiry retention into keeping them forever, and an unchecked box into off', async () => {
    api
      .reply(200, admin())
      .reply(200, settings({ 'require-mfa': true, 'inquiry-retention-days': 30 }))
      .reply(200, settings());

    await saveSettings(null, form({ inquiry: '' }));

    expect(api.last().body).toEqual({ 'require-mfa': false, 'inquiry-retention-days': null });
  });

  it('changes nothing when nothing changed', async () => {
    api.reply(200, admin()).reply(200, settings());

    await expect(saveSettings(null, form({}))).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
    expect(api.requests).toHaveLength(2);
  });

  it('asks for whole numbers of days from 1 to 3650, without calling the API', async () => {
    api.reply(200, admin());

    await expect(
      saveSettings(
        null,
        form({ inquiry: '0', 'api-log': '', 'webhook-delivery': '2.5', event: '3651' }),
      ),
    ).resolves.toEqual({
      ok: false,
      problem: {
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [
          {
            pointer: '/inquiry-retention-days',
            detail: 'Enter a whole number of days from 1 to 3650, or leave it empty.',
          },
          {
            pointer: '/api-log-retention-days',
            detail: 'Enter a whole number of days from 1 to 3650.',
          },
          {
            pointer: '/webhook-delivery-retention-days',
            detail: 'Enter a whole number of days from 1 to 3650.',
          },
          {
            pointer: '/event-retention-days',
            detail: 'Enter a whole number of days from 1 to 3650.',
          },
        ],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('sends a changed text message budget, and nothing for the read-only tripped time (C55.7)', async () => {
    api
      .reply(200, admin())
      .reply(200, settings({ 'otp-sms-max-per-hour': 200, 'otp-sms-budget-tripped-at': null }))
      .reply(200, settings({ 'otp-sms-max-per-hour': 150, 'otp-sms-budget-tripped-at': null }));
    const data = form({});
    data.set('otp-sms-max-per-hour', ' 150 ');
    data.set('otp-sms-budget-tripped-at', '2026-10-20T04:35:00.000Z');

    await expect(saveSettings(null, data)).resolves.toEqual({ ok: true, data: { changed: true } });
    expect(api.last().body).toEqual({ 'otp-sms-max-per-hour': 150 });
  });

  it('sends no unchanged text message budget (C55.7)', async () => {
    api.reply(200, admin()).reply(200, settings({ 'otp-sms-max-per-hour': 200 }));
    const data = form({});
    data.set('otp-sms-max-per-hour', '200');

    await expect(saveSettings(null, data)).resolves.toEqual({ ok: true, data: { changed: false } });
  });

  it.each(['0', '1000001', '2.5', '', 'many'])(
    'refuses a text message budget of "%s" on its field, without calling the API (C55.7)',
    async (budget) => {
      api.reply(200, admin());
      const data = form({});
      data.set('otp-sms-max-per-hour', budget);

      await expect(saveSettings(null, data)).resolves.toEqual({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          detail: 'Some values are not valid.',
          errors: [
            {
              pointer: '/otp-sms-max-per-hour',
              detail: `Enter a whole number of text messages from 1 to ${OTP_SMS_MAX_PER_HOUR.max.toLocaleString('en-US')}; the installation's ceiling may be lower.`,
            },
          ],
        },
      });
      expect(api.requests).toHaveLength(1);
    },
  );

  it("shows the API's refusal of a budget above the installation ceiling on its field (C55.7)", async () => {
    api
      .reply(200, admin())
      .reply(200, settings({ 'otp-sms-max-per-hour': 200 }))
      .replyProblem(422, undefined, {
        errors: [
          { location: 'body', pointer: '/otp-sms-max-per-hour', detail: 'must be at most 1000' },
        ],
      });
    const data = form({});
    data.set('otp-sms-max-per-hour', '5000');

    const result = await saveSettings(null, data);

    expect(result).toMatchObject({
      ok: false,
      problem: {
        status: 422,
        errors: [{ pointer: '/otp-sms-max-per-hour', detail: 'must be at most 1000' }],
      },
    });
    expect(api.last().body).toEqual({ 'otp-sms-max-per-hour': 5000 });
  });

  it('refuses without settings:write, without calling the API', async () => {
    api.reply(200, meDocument({ permissions: ['settings:read'] }));

    await expect(saveSettings(null, form({}))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's problem", async () => {
    api.reply(200, admin()).reply(200, settings()).replyProblem(400);

    await expect(saveSettings(null, form({ event: '120' }))).resolves.toMatchObject({
      ok: false,
      problem: { status: 400, detail: 'Synthetic detail for 400.' },
    });
  });
});

describe('saveSettings: report retention (C73.6, C86)', () => {
  it('sends a changed report retention, and an empty one as null (kept as long as inquiries)', async () => {
    api
      .reply(200, admin())
      .reply(200, settings({ 'report-retention-days': null }))
      .reply(200, settings({ 'report-retention-days': 365 }));
    const data = form({});
    data.set('report-retention-days', ' 365 ');

    await expect(saveSettings(null, data)).resolves.toEqual({ ok: true, data: { changed: true } });
    expect(api.last().body).toEqual({ 'report-retention-days': 365 });

    api
      .reply(200, admin())
      .reply(200, settings({ 'report-retention-days': 365 }))
      .reply(200, settings({ 'report-retention-days': null }));
    const cleared = form({});
    cleared.set('report-retention-days', '');

    await saveSettings(null, cleared);
    expect(api.last().body).toEqual({ 'report-retention-days': null });
  });

  it.each(['0', '3651', '1.5', 'a year'])(
    'asks for a whole number of days from 1 to 3650 for %s, without calling the API',
    async (days) => {
      api.reply(200, admin());
      const data = form({});
      data.set('report-retention-days', days);

      await expect(saveSettings(null, data)).resolves.toMatchObject({
        ok: false,
        problem: {
          errors: [
            {
              pointer: '/report-retention-days',
              detail: 'Enter a whole number of days from 1 to 3650, or leave it empty.',
            },
          ],
        },
      });
    },
  );

  it('sends no report retention the form did not post (an older server)', async () => {
    api.reply(200, admin()).reply(200, settings({ 'require-mfa': false }));

    await expect(saveSettings(null, form({}))).resolves.toEqual({
      ok: true,
      data: { changed: false },
    });
  });
});
