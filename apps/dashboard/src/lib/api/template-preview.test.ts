// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, BFF_TOKEN, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { PREVIEW_IDS, previewDocument, simulationDocument } from '../../testing/routes/preview';
import { SESSION_COOKIE } from '../session-cookie';
import {
  fetchThemeAssetContent,
  previewTemplateVersion,
  simulateTemplateVersion,
  themeAssetAnswer,
} from './template-preview';

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

const VERSION = PREVIEW_IDS.version;

describe('the template preview call (C156.1)', () => {
  it('posts the unsaved members and the locale, and answers the preview document', async () => {
    api.replyTo(`POST /inquiry-template-versions/${VERSION}/preview`, 200, previewDocument());
    const body = {
      data: { attributes: { 'theme-set-id': null, copy: { messages: {} } } },
      meta: { locale: 'en-XA' as const },
    };

    await expect(previewTemplateVersion(VERSION, body)).resolves.toEqual(previewDocument());
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/inquiry-template-versions/${VERSION}/preview`,
      body,
    });
    expect([...api.last().query]).toEqual([]);
  });

  it('refuses a version id that is not one before sending anything', async () => {
    await expect(
      previewTemplateVersion('../inquiries', { meta: { locale: 'en' } }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(api.requests).toEqual([]);
  });

  it('raises the API’s 422 with its pointers', async () => {
    api.replyProblemTo(`POST /inquiry-template-versions/${VERSION}/preview`, 422, undefined, {
      errors: [{ pointer: '/meta/locale', detail: 'Synthetic: not enabled.' }],
    });

    const error: unknown = await previewTemplateVersion(VERSION, { meta: { locale: 'fr' } }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(OpenVerifyApiError);
    expect((error as OpenVerifyApiError).status).toBe(422);
  });
});

describe('the simulate call (C156.4)', () => {
  it('posts the scope in the body only, never in the URL', async () => {
    api.replyTo(`POST /inquiry-template-versions/${VERSION}/simulate`, 200, simulationDocument());
    const body = {
      meta: { scope: { verifications: { id_card: { status: 'failed' as const } } } },
    };

    await expect(simulateTemplateVersion(VERSION, body)).resolves.toEqual(simulationDocument());
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/inquiry-template-versions/${VERSION}/simulate`,
      body,
    });
    expect([...api.last().query]).toEqual([]);
  });

  it('posts a preset id', async () => {
    api.replyTo(`POST /inquiry-template-versions/${VERSION}/simulate`, 200, simulationDocument());

    await simulateTemplateVersion(VERSION, { meta: { 'preset-id': 'builtin:selfie-failed' } });
    expect(api.last().body).toEqual({ meta: { 'preset-id': 'builtin:selfie-failed' } });
  });
});

describe('the theme asset read (C156.2, C160.6)', () => {
  it('reads the asset content with the session, the BFF headers and no cache', async () => {
    api.replyTo(`GET /theme-sets/assets/${PREVIEW_IDS.logo}/content`, 200, {});

    const answer = await fetchThemeAssetContent(PREVIEW_IDS.logo);

    expect(answer?.status).toBe(200);
    const request = api.last();
    expect(request.path).toBe(`/api/v1/theme-sets/assets/${PREVIEW_IDS.logo}/content`);
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(API_URL).toBe('http://api.test:3000');
  });

  it('answers null without a session, and calls nothing', async () => {
    fakeRequest.cookies.clear();

    await expect(fetchThemeAssetContent(PREVIEW_IDS.logo)).resolves.toBeNull();
    expect(api.requests).toEqual([]);
  });

  it('refuses an id that is not a theme asset id before calling', async () => {
    await expect(fetchThemeAssetContent('tsa_../../x')).resolves.toBeNull();
    expect(api.requests).toEqual([]);
  });
});

const bytes = (length: number) => new Uint8Array(new ArrayBuffer(length)).fill(7);
const upstream = (status: number, body: Uint8Array<ArrayBuffer> | null, type: string | null) =>
  new Response(body, { status, headers: type === null ? {} : { 'content-type': type } });

describe('the console’s answer for an asset read', () => {
  it.each(['image/png', 'image/jpeg', 'font/woff2'])(
    'passes a %s on, never cached, nosniff, with no filename',
    async (type) => {
      const answer = await themeAssetAnswer(upstream(200, bytes(32), type));

      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe(type);
      expect(answer.headers.get('cache-control')).toBe('private, no-store');
      expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
      expect(answer.headers.get('content-disposition')).toBeNull();
      expect(new Uint8Array(await answer.arrayBuffer())).toEqual(bytes(32));
    },
  );

  it('answers 502 for a type the preview never takes (an SVG, HTML)', async () => {
    for (const type of ['image/svg+xml', 'text/html', null]) {
      const answer = await themeAssetAnswer(upstream(200, bytes(4), type));
      expect(answer.status).toBe(502);
      expect(await answer.text()).toBe('');
    }
  });

  it('answers 502 for an asset over the 1 MiB the preview takes', async () => {
    const answer = await themeAssetAnswer(upstream(200, bytes(1024 * 1024 + 1), 'image/png'));

    expect(answer.status).toBe(502);
  });

  it('passes the API’s refusals on as a bare status, and 401 without a session', async () => {
    for (const status of [401, 403, 404]) {
      const answer = await themeAssetAnswer(upstream(status, null, 'application/problem+json'));
      expect(answer.status).toBe(status);
      expect(await answer.text()).toBe('');
    }
    expect((await themeAssetAnswer(null)).status).toBe(401);
    expect((await themeAssetAnswer(upstream(500, null, null))).status).toBe(502);
  });
});
