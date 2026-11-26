/**
 * Workflow 9A Stage 1b, checkpoint (T): what `foundation-9a` builds in the API for templates,
 * versions, copy and translations (C154.4, C156, C162.7, C162.9, C149.2, C174.4, C174.5):
 *
 * - the routes of C154.4 and C156 frozen at 501 in their owners' files, while the existing handlers
 *   of those files keep working;
 * - the `template-preview` and `translations-import` policies, each applied before its route answers;
 * - the session builder's hooks (`resolveCopyForSession`, `resolveThemeForSession`), the consent text
 *   check (`checkConsentTextsInTx`) and the fields write check (`validateInquiryFieldsWrite`) at their
 *   call sites, each stub keeping today's answer;
 * - the simulate scope, a preset's scope and a preview body's field defaults masked in stored API
 *   logs, with a screen submission's values.
 *
 * Every value is synthetic.
 */
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_WINDOWS,
  type FlowTheme,
} from '@openverify/contracts';
import { listApiLogs } from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictError, UnprocessableContentError } from './errors.js';
import type { RateLimiter } from './ports.js';
import { maskPersonalData } from './services/api-logs.js';
import { createInquiryTestApi, type InquiryTestApi } from './services/inquiries.test-support.js';
import * as consentTexts from './services/templates/consent-texts.js';
import * as copy from './services/templates/copy.js';
import * as fields from './services/templates/fields.js';
import * as themes from './services/themes/resolve.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  openFlowSession,
} from './test-support/harness.js';

vi.mock('./services/templates/copy.js', { spy: true });
vi.mock('./services/templates/consent-texts.js', { spy: true });
vi.mock('./services/templates/fields.js', { spy: true });
vi.mock('./services/themes/resolve.js', { spy: true });

/** Refuses only the keys of `policy`; every other count passes, as Valkey would. */
function refusing(policy: string): RateLimiter {
  return {
    consume: (key, rule) =>
      Promise.resolve({
        allowed: !key.startsWith(`${policy}:`),
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(0),
        retryAfterSeconds: key.startsWith(`${policy}:`) ? 30 : 0,
      }),
  };
}

let api: InquiryTestApi;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  api = await createInquiryTestApi();
  templateId = await createTemplate(api);
  const template = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-templates/${templateId}`,
      headers: bearer(api.token),
    }),
    200,
  );
  const attributes = template.data.attributes as { 'current-version': { id: string } };
  versionId = attributes['current-version'].id;
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const call = (method: 'GET' | 'POST', url: string, payload?: unknown, headers = {}) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(api.token), ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const ROW = {
  step: 'consent',
  'step-display-name': null,
  component: null,
  'attribute-name': 'consent.processing',
  'locale-values': [{ locale: 'fr', value: 'Texte synthétique' }],
};

// Built by `api-templates` (Workflow 9A Stage 3), each now held by its own suite: validate, diff,
// restore, copy, used-by and promote (`routes/server/inquiry-template-operations.test.ts`) and the
// deployments; simulate by `api-templates-carry` (Workflow 9B,
// `services/templates/simulate-version.test.ts`) and preview by `api-templates-finish` (Workflow 9B,
// `services/templates/preview.test.ts`). None of the routes of C154.4 and C156 answers 501 now.
describe('the frozen routes of C154.4 and C156', () => {
  it('keeps the existing template and version routes working', async () => {
    expectStatus(await call('GET', `/inquiry-templates/${templateId}`), 200);
    expectStatus(await call('GET', `/inquiry-template-versions/${versionId}`), 200);
  });
});

describe('the template-preview and translations-import policies (C174.4)', () => {
  it('are named with their limits and windows', () => {
    expect([...RATE_LIMIT_POLICIES]).toEqual(
      expect.arrayContaining(['template-preview', 'translations-import']),
    );
    const limits: Readonly<Record<string, number>> = RATE_LIMIT_DEFAULTS;
    const windows: Readonly<Record<string, number>> = RATE_LIMIT_POLICY_WINDOWS;
    expect(limits['template-preview']).toBe(120);
    expect(windows['template-preview']).toBe(60);
    expect(limits['translations-import']).toBe(30);
    expect(windows['translations-import']).toBe(3600);
  });

  it('refuses preview, simulate and validate with 429 past template-preview, before anything else', async () => {
    const limited = await createInquiryTestApi({ rateLimiter: refusing('template-preview') });
    try {
      const template = await createTemplate(limited);
      const version = expectStatus(
        await limited.app.inject({
          method: 'GET',
          url: `/api/v1/inquiry-templates/${template}`,
          headers: bearer(limited.token),
        }),
        200,
      ).data.attributes as { 'current-version': { id: string } };
      const id = version['current-version'].id;
      for (const [path, payload] of [
        ['preview', { meta: { locale: 'en' } }],
        ['simulate', { meta: { 'preset-id': 'builtin:government-id-passes' } }],
        ['validate', undefined],
      ] as const) {
        const response = await limited.app.inject({
          method: 'POST',
          url: `/api/v1/inquiry-template-versions/${id}/${path}`,
          headers: bearer(limited.token),
          ...(payload === undefined ? {} : { payload }),
        });
        expect(response.statusCode, `${path}: ${response.body}`).toBe(429);
      }
    } finally {
      await limited.close();
    }
  });

  it('refuses a translations import with 429 past translations-import, JSON or CSV', async () => {
    const limited = await createInquiryTestApi({ rateLimiter: refusing('translations-import') });
    try {
      const template = await createTemplate(limited);
      const json = await limited.app.inject({
        method: 'POST',
        url: `/api/v1/inquiry-templates/${template}/translations`,
        headers: bearer(limited.token),
        payload: { data: { attributes: { translations: [ROW] } } },
      });
      expect(json.statusCode, json.body).toBe(429);
      const csv = await limited.app.inject({
        method: 'POST',
        url: `/api/v1/inquiry-templates/${template}/translations.csv`,
        headers: { ...bearer(limited.token), 'content-type': 'text/csv' },
        payload: 'step,component,attribute,fr\n',
      });
      expect(csv.statusCode, csv.body).toBe(429);
      // Reading the translations is not an import.
      const read = await limited.app.inject({
        method: 'GET',
        url: `/api/v1/inquiry-templates/${template}/translations`,
        headers: bearer(limited.token),
      });
      expect(read.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('the session builder, consent and fields hooks (C162.6, C160.7, C162.9, C149.2)', () => {
  it('asks for the copy and the theme of every session, and serves neither until built', async () => {
    const { sessionToken } = await openFlowSession(api);
    const session = expectStatus(
      await api.app.inject({
        method: 'GET',
        url: '/api/v1/flow/session',
        headers: bearer(sessionToken),
      }),
      200,
    ) as unknown as Record<string, unknown>;
    expect(copy.resolveCopyForSession).toHaveBeenCalledTimes(1);
    expect(themes.resolveThemeForSession).toHaveBeenCalledTimes(1);
    expect(session).not.toHaveProperty('copy');
    expect(session).not.toHaveProperty('theme');
  });

  it('serves the theme and the copy the hooks resolve', async () => {
    const theme: FlowTheme = {
      'theme-set-id': null,
      revision: null,
      mode: 'light',
      light: Object.fromEntries(
        [
          'primary',
          'primary-hover',
          'on-primary',
          'danger',
          'danger-hover',
          'surface',
          'canvas',
          'ink',
          'ink-muted',
          'line',
          'control',
          'focus',
        ].map((token) => [token, '#123456']),
      ) as FlowTheme['light'],
      dark: null,
      radius: 8,
      font: { kind: 'system', platforms: ['web', 'android'] },
      logo: null,
      placement: 'header',
    };
    vi.mocked(themes.resolveThemeForSession).mockResolvedValueOnce(theme);
    vi.mocked(copy.resolveCopyForSession).mockResolvedValueOnce({
      messages: { en: { 'flow.completion': 'Done' } },
    });
    const { sessionToken } = await openFlowSession(api);
    const session = expectStatus(
      await api.app.inject({
        method: 'GET',
        url: '/api/v1/flow/session',
        headers: bearer(sessionToken),
      }),
      200,
    ) as unknown as Record<string, unknown>;
    expect(session.theme).toEqual(theme);
    expect(session.copy).toEqual({ messages: { en: { 'flow.completion': 'Done' } } });
  });

  it('checks the consent texts before consent is recorded', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    vi.mocked(consentTexts.checkConsentTextsInTx).mockRejectedValueOnce(
      new UnprocessableContentError('The consent texts do not match.'),
    );
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(sessionToken),
      payload: {
        accepted: true,
        'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
        locale: 'en',
      },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(consentTexts.checkConsentTextsInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        environmentId: api.environmentId,
        inquiryId,
        sessionId: expect.stringMatching(/^iqse_/) as unknown,
      },
      expect.objectContaining({ locale: 'en' }),
    );
    const { rows } = await api.database.client.query(
      'select 1 from inquiry_sessions where inquiry_id = $1 and consent is not null',
      [inquiryId],
    );
    expect(rows).toEqual([]);
  });

  it("checks the fields on create and on PATCH, and refuses with the check's problem", async () => {
    const created = await createInquiry(api, { fields: { name_first: 'Alexis' } });
    expect(fields.validateInquiryFieldsWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'create', fields: { name_first: 'Alexis' } }),
    );
    vi.mocked(fields.validateInquiryFieldsWrite).mockRejectedValueOnce(
      new ConflictError('field_write_once'),
    );
    const patched = await api.app.inject({
      method: 'PATCH',
      url: `/api/v1/inquiries/${created}`,
      headers: bearer(api.token),
      payload: { data: { attributes: { fields: { name_first: 'Robin' } } } },
    });
    expect(patched.statusCode, patched.body).toBe(409);
    expect(fields.validateInquiryFieldsWrite).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'patch',
        inquiryId: created,
        fields: { name_first: 'Robin' },
      }),
    );
    vi.mocked(fields.validateInquiryFieldsWrite).mockRejectedValueOnce(
      new UnprocessableContentError('field_unknown'),
    );
    const refused = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: bearer(api.token),
      payload: {
        data: {
          attributes: { 'inquiry-template-id': templateId, fields: { name_first: 'Robin' } },
        },
      },
    });
    expect(refused.statusCode, refused.body).toBe(422);
  });
});

describe('masking in stored API logs (C174.5)', () => {
  it("nulls a screen submission's values, a simulate or preset scope and a field default, keeping the rest", () => {
    expect(maskPersonalData({ values: { name_first: 'Alexis' }, button: 'next' })).toEqual({
      values: null,
      button: 'next',
    });
    expect(maskPersonalData({ meta: { scope: { fields: { name_first: 'Alexis' } } } })).toEqual({
      meta: { scope: null },
    });
    expect(
      maskPersonalData({
        data: { type: 'simulation-preset', attributes: { name: 'n', scope: { a: 1 } } },
      }),
    ).toEqual({ data: { type: 'simulation-preset', attributes: { name: 'n', scope: null } } });
    const schemas = [
      { key: 'name_first', type: 'string', label: 'First name', pii: true, default: 'Alexis' },
      { key: 'plan', type: 'string', label: 'Plan', pii: false },
    ];
    expect(
      maskPersonalData({
        data: { attributes: { 'field-schemas': schemas } },
        meta: { locale: 'en' },
      }),
    ).toEqual({
      data: {
        attributes: {
          'field-schemas': [
            { key: 'name_first', type: 'string', label: 'First name', pii: true, default: null },
            { key: 'plan', type: 'string', label: 'Plan', pii: false },
          ],
        },
      },
      meta: { locale: 'en' },
    });
  });
});

describe('masking in stored API logs, route by route (C174.5)', () => {
  // A sentinel no route or masking rule could produce by itself (synthetic).
  const CANARY = 'Synthetic-Canary-Robin';

  /** The stored entry of `requestId`, as a reader without `pii:view` gets it. */
  async function maskedLogOf(requestId: string): Promise<string> {
    let id: string | undefined;
    await vi.waitFor(async () => {
      const { items } = await listApiLogs(api.database.db, api.environmentId, { size: 100 });
      id = items.find((item) => item.requestId === requestId)?.id;
      expect(id).toBeDefined();
    });
    const reader = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });
    const read = await api.app.inject({
      url: `/api/v1/api-logs/${String(id)}`,
      headers: bearer(reader),
    });
    expect(read.statusCode, read.body).toBe(200);
    return read.body;
  }

  it('keeps no simulated scope value of a simulate body in the log a reader without pii:view reads', async () => {
    const response = await call('POST', `/inquiry-template-versions/${versionId}/simulate`, {
      meta: { scope: { fields: { name_first: CANARY }, account: { name_last: CANARY } } },
    });
    const log = await maskedLogOf(String(response.headers['x-request-id']));
    expect(log).not.toContain(CANARY);
    expect(JSON.parse(log)).toMatchObject({
      data: { attributes: { 'request-body': { meta: { scope: null } } } },
    });
  });

  it("keeps no field default of a preview body in the log, and keeps the field's configuration", async () => {
    const response = await call('POST', `/inquiry-template-versions/${versionId}/preview`, {
      data: {
        attributes: {
          'field-schemas': [
            { key: 'name_first', type: 'string', label: 'First name', pii: true, default: CANARY },
          ],
        },
      },
      meta: { locale: 'en' },
    });
    const log = await maskedLogOf(String(response.headers['x-request-id']));
    expect(log).not.toContain(CANARY);
    expect(JSON.parse(log)).toMatchObject({
      data: {
        attributes: {
          'request-body': {
            data: { attributes: { 'field-schemas': [{ key: 'name_first', default: null }] } },
          },
        },
      },
    });
  });
});
