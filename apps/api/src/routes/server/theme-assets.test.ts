/**
 * C160.6 (`api-themes`, Workflow 9B; decisions 27, 28; review F27, P17): theme assets. A logo is
 * typed by its bytes, capped at 256 KiB and 2,048 px a side and re-encoded synchronously through
 * vision's rendition endpoint (a busy lane is a retryable 503, never a pending asset); a font is
 * WOFF2 with its licence attested by a user; SVG and anything else is 415 `asset_type_refused`.
 * Operators read an asset as an attachment never cached; flows read their environment's with the
 * session token, cached for an hour. Every image and font is a few bytes made here.
 */
import { THEME_ASSET_LIMITS } from '@openverify/contracts';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeVision } from '../../jobs/testing.js';
import { VisionServiceError } from '../../vision/index.js';
import { actorOf } from '../../ports.js';
import { uploadThemeAsset } from '../../services/themes/assets.js';
import {
  bearer,
  createTemplate,
  createTestApi,
  expectStatus,
  multipart,
  resumeInquiry,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const u32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

/** A PNG signature and an `IHDR` stating `width` x `height`; nothing decodes it but vision. */
function png(width: number, height: number, padTo = 0): Uint8Array {
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  const bytes = new Uint8Array(Math.max(head.length, padTo));
  bytes.set(head);
  return bytes;
}

/** A minimal WOFF2 header (`wOF2`, flavor, its own length, one table), padded to `size`. */
function woff2(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00, ...u32(size), 0x00, 0x01]);
  return bytes;
}

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const RENDERED = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function upload(fields: Record<string, string>, file: Uint8Array, token = api.token) {
  const form = await multipart({ ...fields, file: { bytes: file, filename: 'asset.bin' } });
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/theme-sets/assets',
    headers: { ...bearer(token), ...form.headers },
    payload: form.payload,
  });
}

const fontFields = { kind: 'font', 'meta[licence-attested]': 'true' };

/** The service with a vision client bound, as the container binds it. */
async function uploadWithVision(vision: ReturnType<typeof createFakeVision>, bytes: Uint8Array) {
  const form = await multipart({ kind: 'logo', file: { bytes, filename: 'logo.png' } });
  return uploadThemeAsset(
    { ...api.deps, vision: vision.client },
    {
      ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
      actor: actorOf({
        kind: 'api-key',
        apiKeyId: 'key_01M5CK16P0D13FXHZSS4TCFBVH',
        organizationId: api.organizationId,
        environmentId: api.environmentId,
        environmentKind: 'sandbox',
        permissions: new Set(),
      }),
      userId: null,
    },
    { body: form.payload, contentType: form.headers['content-type'] },
  );
}

describe('a logo (C160.6; review F27)', () => {
  it('is re-encoded through vision before it is stored, and only the rendition is kept', async () => {
    const vision = createFakeVision();
    vision.answers.createRendition = {
      source: 'image',
      pageCount: 1,
      truncated: false,
      pages: [{ page: 1, mediaType: 'image/png', width: 64, height: 32, bytes: RENDERED }],
    };
    const source = png(64, 32);

    const document = await uploadWithVision(vision, source);

    expect(document.data.attributes).toMatchObject({
      kind: 'logo',
      'media-type': 'image/png',
      'byte-size': RENDERED.byteLength,
      width: 64,
      height: 32,
      'licence-attestation': null,
      'unicode-range': null,
    });
    expect(vision.calls.filter(({ endpoint }) => endpoint === 'create-rendition')).toHaveLength(1);
    const audit = api.audit
      .withAction('theme-asset.created')
      .find((entry) => entry.resourceId === document.data.id);
    expect(audit).toMatchObject({
      resourceType: 'theme-asset',
      metadata: { kind: 'logo', 'media-type': 'image/png', 'byte-size': RENDERED.byteLength },
    });
    const content = await api.app.inject({
      url: `/api/v1/theme-sets/assets/${document.data.id}/content`,
      headers: bearer(api.token),
    });
    expect(content.statusCode).toBe(200);
    expect(new Uint8Array(content.rawPayload)).toEqual(RENDERED);
    expect(content.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, no-store',
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
    });
  });

  it('answers a busy rendition lane as a retryable 503, storing nothing', async () => {
    const vision = createFakeVision();
    vision.answers.createRendition = new VisionServiceError('/v1/renditions', 503, 'busy');
    const before = api.storage.keys().length;

    const refused = await uploadWithVision(vision, png(8, 8)).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toMatchObject({ status: 503, headers: { 'retry-after': '10' } });
    expect(api.storage.keys()).toHaveLength(before);
  });

  it('answers a source vision cannot decode as 415 asset_type_refused', async () => {
    const vision = createFakeVision();
    vision.answers.createRendition = new VisionServiceError('/v1/renditions', 415, 'unsupported');

    await expect(uploadWithVision(vision, png(8, 8))).rejects.toMatchObject({
      status: 415,
      code: 'asset_type_refused',
    });
  });

  it('is refused as unavailable while no vision client is bound to the API (503)', async () => {
    const response = await upload({ kind: 'logo' }, png(8, 8));
    expect(response.statusCode, response.body).toBe(503);
    expect(response.headers['retry-after']).toBe('10');
  });

  it('is refused over 2,048 px a side before vision is asked (422 at /file)', async () => {
    const vision = createFakeVision();
    await expect(uploadWithVision(vision, png(2049, 16))).rejects.toMatchObject({
      status: 422,
      errors: [{ pointer: '/file' }],
    });
    expect(vision.calls).toHaveLength(0);
  });

  it('is refused over 256 KiB (413)', async () => {
    const response = await upload(
      { kind: 'logo' },
      png(8, 8, THEME_ASSET_LIMITS['logo-bytes'] + 1),
    );
    expect(response.statusCode, response.body).toBe(413);
  });

  it.each([
    ['an SVG', SVG],
    ['a font', woff2()],
    ['text', new TextEncoder().encode('synthetic')],
  ])('is refused as %s, by its bytes, with 415 asset_type_refused', async (_what, bytes) => {
    const response = await upload({ kind: 'logo' }, bytes);
    expect(response.statusCode, response.body).toBe(415);
    expect(response.json()).toMatchObject({ code: 'asset_type_refused' });
  });
});

describe('a font (C160.6; decision 27)', () => {
  it('is stored as WOFF2 with the user who attested its licence and its unicode-range', async () => {
    const tenant = await api.newTenant();
    const user = api.newUserToken(tenant.environmentId, {
      userId: 'usr_01M5CK16P0D13FXHZSS4TCFBVH',
    });

    const document = expectStatus(
      await upload({ ...fontFields, 'unicode-range': 'U+0600-06FF, U+0750-077F' }, woff2(), user),
      201,
    );

    expect(document.data.attributes).toMatchObject({
      kind: 'font',
      'media-type': 'font/woff2',
      'byte-size': 64,
      width: null,
      height: null,
      'licence-attestation': { by: { type: 'user', id: 'usr_01M5CK16P0D13FXHZSS4TCFBVH' } },
      'unicode-range': 'U+0600-06FF, U+0750-077F',
    });
  });

  it('needs its licence attested (400 at the field)', async () => {
    const tenant = await api.newTenant();
    const user = api.newUserToken(tenant.environmentId);
    const response = await upload({ kind: 'font' }, woff2(), user);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ pointer: '/meta[licence-attested]' }] });
  });

  it('is refused from an API key, which cannot attest a licence (403)', async () => {
    const response = await upload(fontFields, woff2());
    expect(response.statusCode, response.body).toBe(403);
  });

  it.each([
    ['a PNG', png(8, 8)],
    ['a WOFF2 header whose length is not the file’s', woff2(64).fill(0, 8, 12)],
    ['a WOFF (version 1) file', new TextEncoder().encode('wOFF'.padEnd(64, '\u0000'))],
  ])('is refused as %s with 415 asset_type_refused', async (_what, bytes) => {
    const tenant = await api.newTenant();
    const user = api.newUserToken(tenant.environmentId);
    const response = await upload(fontFields, bytes, user);
    expect(response.statusCode, response.body).toBe(415);
  });

  it('is refused over 512 KiB (413)', async () => {
    const tenant = await api.newTenant();
    const user = api.newUserToken(tenant.environmentId);
    const response = await upload(fontFields, woff2(THEME_ASSET_LIMITS['font-bytes'] + 4), user);
    expect(response.statusCode, response.body).toBe(413);
  });
});

/** A theme set of the main environment with `styles`, answering its id. */
async function themeSet(name: string, styles: Record<string, unknown>): Promise<string> {
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/theme-sets',
    headers: bearer(api.token),
    payload: { data: { type: 'theme-set', attributes: { name, styles } } },
  });
  return expectStatus(created, 201).data.id;
}

/** A flow session of an inquiry that renders `themeSetId` (C160.7: the inquiry's set first). */
async function sessionRendering(themeSetId: string | null): Promise<string> {
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiries',
    headers: bearer(api.token),
    payload: {
      data: {
        type: 'inquiry',
        attributes: {
          'inquiry-template-id': await createTemplate(api, api.token),
          ...(themeSetId === null ? {} : { 'theme-set-id': themeSetId }),
        },
      },
    },
  });
  const inquiryId = expectStatus(created, 201).data.id;
  return resumeInquiry(api, inquiryId);
}

describe('reading an asset (C160.6; review P17)', () => {
  async function storedFont(token: string) {
    return expectStatus(await upload(fontFields, woff2(96), token), 201).data.id;
  }

  it('is the operator’s, in the caller’s environment, with theme-sets:read', async () => {
    const tenant = await api.newTenant();
    const id = await storedFont(api.newUserToken(tenant.environmentId));
    const url = `/api/v1/theme-sets/assets/${id}/content`;

    const read = await api.app.inject({ url, headers: bearer(tenant.token) });
    expect(read.statusCode).toBe(200);
    expect(new Uint8Array(read.rawPayload)).toEqual(woff2(96));
    expect(read.headers['content-type']).toBe('font/woff2');

    const elsewhere = await api.app.inject({ url, headers: bearer(api.token) });
    expect(elsewhere.statusCode).toBe(404);
    const noScope = await api.newApiKey(tenant.environmentId, { scopes: ['inquiries:read'] });
    expect((await api.app.inject({ url, headers: bearer(noScope) })).statusCode).toBe(403);
  });

  it('is the flow’s with a session of the same environment, cached privately for an hour', async () => {
    const id = await storedFont(api.newUserToken(api.environmentId));
    // R002 (Workflow 10A): the session's theme names the font, as the flow is served it.
    const sessionToken = await sessionRendering(
      await themeSet('Session font', {
        typography: { font: { kind: 'uploaded', 'asset-id': id } },
      }),
    );
    const url = `/api/v1/flow/theme-assets/${id}`;

    const read = await api.app.inject({ url, headers: bearer(sessionToken) });
    expect(read.statusCode, read.body).toBe(200);
    expect(new Uint8Array(read.rawPayload)).toEqual(woff2(96));
    expect(read.headers).toMatchObject({
      'content-type': 'font/woff2',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });

    const tenant = await api.newTenant();
    const theirs = await storedFont(api.newUserToken(tenant.environmentId));
    const other = await api.app.inject({
      url: `/api/v1/flow/theme-assets/${theirs}`,
      headers: bearer(sessionToken),
    });
    expect(other.statusCode).toBe(404);
    expect((await api.app.inject({ url })).statusCode).toBe(401);
  });

  it('may be named by a theme set of its environment, by its kind', async () => {
    const id = await storedFont(api.newUserToken(api.environmentId));
    const set = await api.app.inject({
      method: 'POST',
      url: '/api/v1/theme-sets',
      headers: bearer(api.token),
      payload: {
        data: {
          type: 'theme-set',
          attributes: {
            name: 'With font',
            styles: { typography: { font: { kind: 'uploaded', 'asset-id': id } } },
          },
        },
      },
    });
    expect(set.statusCode, set.body).toBe(201);

    const asLogo = await api.app.inject({
      method: 'POST',
      url: '/api/v1/theme-sets',
      headers: bearer(api.token),
      payload: {
        data: {
          type: 'theme-set',
          attributes: {
            name: 'Font as logo',
            styles: { branding: { logo: { 'asset-id': id, decorative: true } } },
          },
        },
      },
    });
    expect(asLogo.statusCode, asLogo.body).toBe(422);
  });
});

describe('the flow reads only the assets of the theme its session renders (R002)', () => {
  async function logo(): Promise<string> {
    const vision = createFakeVision();
    vision.answers.createRendition = {
      source: 'image',
      pageCount: 1,
      truncated: false,
      pages: [{ page: 1, mediaType: 'image/png', width: 64, height: 32, bytes: RENDERED }],
    };
    return (await uploadWithVision(vision, png(64, 32))).data.id;
  }
  async function font(): Promise<string> {
    return expectStatus(
      await upload(fontFields, woff2(80), api.newUserToken(api.environmentId)),
      201,
    ).data.id;
  }
  const read = (id: string, sessionToken: string) =>
    api.app.inject({ url: `/api/v1/flow/theme-assets/${id}`, headers: bearer(sessionToken) });
  /** A problem with what names the asked id and the request taken out. */
  const problemOf = (response: Awaited<ReturnType<typeof read>>, id: string) => {
    const rest = { ...response.json<Record<string, unknown>>() };
    // The request's own members; everything else must be the same for both ids.
    delete rest.instance;
    delete rest['request-id'];
    delete rest.requestId;
    return JSON.parse(JSON.stringify(rest).replaceAll(id, '<id>')) as unknown;
  };

  it('serves the logo and the uploaded font the session’s theme names, with the read’s headers', async () => {
    const [logoId, fontId] = [await logo(), await font()];
    const sessionToken = await sessionRendering(
      await themeSet('Named assets', {
        branding: { logo: { 'asset-id': logoId, decorative: true } },
        typography: { font: { kind: 'uploaded', 'asset-id': fontId } },
      }),
    );

    const logoRead = await read(logoId, sessionToken);
    expect(logoRead.statusCode, logoRead.body).toBe(200);
    expect(new Uint8Array(logoRead.rawPayload)).toEqual(RENDERED);
    expect(logoRead.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    const fontRead = await read(fontId, sessionToken);
    expect(fontRead.statusCode, fontRead.body).toBe(200);
    expect(new Uint8Array(fontRead.rawPayload)).toEqual(woff2(80));
  });

  it('answers another theme set’s asset of the same environment as it answers an unknown one: 404, nothing apart', async () => {
    const [ownLogo, otherLogo, otherFont, unnamed] = [
      await logo(),
      await logo(),
      await font(),
      await font(),
    ];
    const sessionToken = await sessionRendering(
      await themeSet('Session theme', {
        branding: { logo: { 'asset-id': ownLogo, decorative: true } },
      }),
    );
    await themeSet('Another theme', {
      branding: { logo: { 'asset-id': otherLogo, decorative: true } },
      typography: { font: { kind: 'uploaded', 'asset-id': otherFont } },
    });
    const unknown = 'tsa_01JZ0000000000000000000000';

    const unknownRead = await read(unknown, sessionToken);
    expect(unknownRead.statusCode).toBe(404);
    for (const id of [otherLogo, otherFont, unnamed]) {
      const answer = await read(id, sessionToken);
      expect(answer.statusCode, id).toBe(404);
      expect(answer.headers['cache-control']).not.toContain('max-age');
      expect(problemOf(answer, id)).toEqual(problemOf(unknownRead, unknown));
    }
    expect((await read(ownLogo, sessionToken)).statusCode).toBe(200);
  });

  it('serves no asset to a session that renders the built-in theme', async () => {
    const fontId = await font();
    await themeSet('Not the session’s', {
      typography: { font: { kind: 'uploaded', 'asset-id': fontId } },
    });
    const sessionToken = await sessionRendering(null);

    expect((await read(fontId, sessionToken)).statusCode).toBe(404);
  });
});

describe('the flow also reads the image assets of the screens its pinned version renders (KP10-11, C195.1)', () => {
  const read = (id: string, sessionToken: string) =>
    api.app.inject({ url: `/api/v1/flow/theme-assets/${id}`, headers: bearer(sessionToken) });
  async function image(): Promise<string> {
    const vision = createFakeVision();
    vision.answers.createRendition = {
      source: 'image',
      pageCount: 1,
      truncated: false,
      pages: [{ page: 1, mediaType: 'image/png', width: 64, height: 32, bytes: RENDERED }],
    };
    return (await uploadWithVision(vision, png(64, 32))).data.id;
  }
  /** A session of an inquiry whose pinned flow shows `assetId` in an image nested in a container. */
  async function sessionShowing(assetId: string): Promise<string> {
    const flow = flowV2Schema.parse({
      metadata: { specVersion: 2, id: 'images', version: 1, name: 'Images' },
      entry: 'consent',
      steps: [
        { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
        {
          id: 'welcome',
          type: 'screen',
          components: [
            {
              id: 'box',
              kind: 'container',
              direction: 'vertical',
              children: [
                {
                  id: 'banner',
                  kind: 'image',
                  assetId,
                  altKey: 'welcome.banner.alt',
                  decorative: false,
                },
              ],
            },
            { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
          ],
        },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        { id: 'e1', from: 'consent', port: 'next', to: 'welcome' },
        { id: 'e2', from: 'welcome', port: 'next', to: 'done' },
      ],
    });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow });
    return resumeInquiry(api, inquiry.id);
  }

  it('serves an image asset of a screen of the pinned version, and still nothing else', async () => {
    const [shown, other] = [await image(), await image()];
    const sessionToken = await sessionShowing(shown);

    const answer = await read(shown, sessionToken);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(new Uint8Array(answer.rawPayload)).toEqual(RENDERED);
    expect(answer.headers['cache-control']).toBe('private, max-age=3600');
    expect((await read(other, sessionToken)).statusCode).toBe(404);
  });
});
