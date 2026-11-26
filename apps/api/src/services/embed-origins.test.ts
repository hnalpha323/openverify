/**
 * C157.2, C158.2, C158.4, C158.5 (Workflow 9A, flow-server-embed): the embed policy the flow server
 * reads, the redirect URI rules, and the completion redirect a session carries. Every origin is a
 * reserved name (example.com, localhost) and every value is synthetic.
 */
import {
  environments,
  getInquiry,
  inquiryTemplates,
  inquiryTemplateVersions,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { bearer, createInquiry, createTemplate } from '../test-support/harness.js';
import {
  allowedEmbedOrigins,
  checkInquiryRedirectUri,
  completionRedirectUrl,
  embedPolicyFor,
  redirectUriRefusal,
  redirectUrlFor,
  type RedirectRules,
} from './embed-origins.js';

const SHOP = 'https://shop.example.com';
const PAY = 'https://pay.example.com';
const WILDCARD = 'https://*.example.org';
const LOCAL = 'http://localhost:5173';
const INQUIRY_ID = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

describe('allowedEmbedOrigins (C158.2)', () => {
  it("takes the environment's list when the version names none", () => {
    expect(allowedEmbedOrigins('sandbox', [SHOP, PAY], [])).toEqual([SHOP, PAY]);
  });

  it("narrows to the version's origins the environment still allows", () => {
    expect(allowedEmbedOrigins('production', [SHOP, PAY], [PAY])).toEqual([PAY]);
    expect(allowedEmbedOrigins('production', [SHOP], [PAY, SHOP])).toEqual([SHOP]);
    expect(allowedEmbedOrigins('production', [SHOP], [PAY])).toEqual([]);
  });

  it("drops an entry the environment's kind refuses, wherever it was stored", () => {
    expect(allowedEmbedOrigins('production', [LOCAL, SHOP, 'https://*.vercel.app'], [])).toEqual([
      SHOP,
    ]);
    expect(allowedEmbedOrigins('sandbox', [LOCAL, 'javascript:alert(1)'], [])).toEqual([LOCAL]);
  });
});

describe('redirectUriRefusal (C158.4)', () => {
  const production: RedirectRules = {
    environmentKind: 'production',
    allowedOrigins: [SHOP, WILDCARD],
    schemes: ['myapp'],
  };

  it('accepts an exact origin match, at any path and query', () => {
    expect(redirectUriRefusal(`${SHOP}/done?ref=7`, production)).toBeNull();
    expect(redirectUriRefusal(`${SHOP}:443/done`, production)).toBeNull();
  });

  it('matches a wildcard on a dot boundary only', () => {
    expect(redirectUriRefusal('https://a.b.example.org/x', production)).toBeNull();
    expect(redirectUriRefusal('https://example.org/x', production)).toBe('origin');
    expect(redirectUriRefusal('https://evilexample.org/x', production)).toBe('origin');
  });

  it('refuses another port, another host and http', () => {
    expect(redirectUriRefusal(`${SHOP}:8443/done`, production)).toBe('origin');
    expect(redirectUriRefusal('https://other.example.com/done', production)).toBe('origin');
    expect(redirectUriRefusal('http://shop.example.com/done', production)).toBe('origin');
  });

  it('takes http://localhost in sandbox only', () => {
    const sandbox: RedirectRules = {
      environmentKind: 'sandbox',
      allowedOrigins: [LOCAL],
      schemes: [],
    };
    expect(redirectUriRefusal(`${LOCAL}/callback`, sandbox)).toBeNull();
    expect(
      redirectUriRefusal(`${LOCAL}/callback`, { ...sandbox, environmentKind: 'production' }),
    ).toBe('origin');
  });

  it('refuses userinfo, a malformed or over-long URI', () => {
    expect(redirectUriRefusal('https://user:secret@shop.example.com/done', production)).toBe(
      'userinfo',
    );
    expect(redirectUriRefusal('not a uri', production)).toBe('not_a_uri');
    expect(redirectUriRefusal(`${SHOP}/${'a'.repeat(2048)}`, production)).toBe('not_a_uri');
  });

  it("takes a custom scheme only from the version's list, never a denylisted one", () => {
    expect(redirectUriRefusal('myapp://verified', production)).toBeNull();
    expect(redirectUriRefusal('otherapp://verified', production)).toBe('scheme');
    for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:x']) {
      expect(
        redirectUriRefusal(uri, { ...production, schemes: ['javascript', 'data', 'file', 'blob'] }),
        uri,
      ).toBe('scheme');
    }
  });
});

describe('completionRedirectUrl (C158.5)', () => {
  it('appends only inquiry-id, and status when the version opts in', () => {
    expect(
      completionRedirectUrl(`${SHOP}/done?ref=7#top`, { inquiryId: INQUIRY_ID, status: null }),
    ).toBe(`${SHOP}/done?ref=7&inquiry-id=${INQUIRY_ID}#top`);
    expect(
      completionRedirectUrl(`${SHOP}/done`, { inquiryId: INQUIRY_ID, status: 'completed' }),
    ).toBe(`${SHOP}/done?inquiry-id=${INQUIRY_ID}&status=completed`);
  });

  it("replaces an inquiry-id or status the URI already carried, never trusting the author's", () => {
    expect(
      completionRedirectUrl(`${SHOP}/done?inquiry-id=inq_other&status=approved`, {
        inquiryId: INQUIRY_ID,
        status: null,
      }),
    ).toBe(`${SHOP}/done?inquiry-id=${INQUIRY_ID}`);
  });

  it('works for a custom scheme', () => {
    expect(
      completionRedirectUrl('myapp://verified', { inquiryId: INQUIRY_ID, status: 'failed' }),
    ).toBe(`myapp://verified?inquiry-id=${INQUIRY_ID}&status=failed`);
  });
});

describe('the embed policy and the redirects of stored inquiries', () => {
  let api: InquiryTestApi;

  beforeAll(async () => {
    api = await createInquiryTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  const setSettings = async (environmentId: string, settings: Record<string, unknown>) => {
    await api.database.db
      .update(environments)
      .set({ settings })
      .where(eq(environments.id, environmentId));
  };

  const setVersion = async (
    templateId: string,
    members: Partial<typeof inquiryTemplateVersions.$inferInsert>,
  ) => {
    await api.database.db
      .update(inquiryTemplateVersions)
      .set(members)
      .where(eq(inquiryTemplateVersions.inquiryTemplateId, templateId));
  };

  const versionOf = async (templateId: string): Promise<string> => {
    const [row] = await api.database.db
      .select({ id: inquiryTemplateVersions.id })
      .from(inquiryTemplateVersions)
      .where(eq(inquiryTemplateVersions.inquiryTemplateId, templateId));
    if (row === undefined) {
      throw new Error('no version');
    }
    return row.id;
  };

  const inquiryRow = async (id: string) => {
    const inquiry = await getInquiry(api.database.db, api.environmentId, id);
    if (inquiry === null) {
      throw new Error('no inquiry');
    }
    return inquiry;
  };

  const createWithRedirect = (templateId: string, redirectUri: string) =>
    api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: bearer(api.token),
      payload: {
        data: { attributes: { 'inquiry-template-id': templateId, 'redirect-uri': redirectUri } },
      },
    });

  describe('embedPolicyFor (C157.2)', () => {
    it("answers the inquiry's template, environment and the version's narrowed origins", async () => {
      await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP, PAY, LOCAL] });
      const templateId = await createTemplate(api);
      const inquiryId = await createInquiry(api, { templateId });

      expect(await embedPolicyFor(api.database.db, inquiryId)).toEqual({
        'inquiry-id': inquiryId,
        'template-id': templateId,
        'environment-id': api.environmentId,
        'frame-ancestors': [SHOP, PAY, LOCAL],
      });

      await setVersion(templateId, { embedOrigins: [PAY, 'https://gone.example.com'] });
      expect((await embedPolicyFor(api.database.db, inquiryId))?.['frame-ancestors']).toEqual([
        PAY,
      ]);
    });

    it('answers an empty list when the environment allows no origin', async () => {
      await setSettings(api.environmentId, {});
      const inquiryId = await createInquiry(api);

      expect((await embedPolicyFor(api.database.db, inquiryId))?.['frame-ancestors']).toEqual([]);
    });

    it('answers null for an unknown inquiry and for an inactive template alike', async () => {
      await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
      const templateId = await createTemplate(api);
      const inquiryId = await createInquiry(api, { templateId });
      await api.database.db
        .update(inquiryTemplates)
        .set({ status: 'archived' })
        .where(eq(inquiryTemplates.id, templateId));

      expect(await embedPolicyFor(api.database.db, INQUIRY_ID)).toBeNull();
      expect(await embedPolicyFor(api.database.db, inquiryId)).toBeNull();
    });

    it("drops what a production environment's kind refuses", async () => {
      const production = await api.newTenant({ kind: 'production' });
      await setSettings(production.environmentId, {
        'allowed-embed-origins': [LOCAL, SHOP],
      });
      const templateId = await createTemplate(api, production.token);
      const inquiryId = await createInquiry(api, { token: production.token, templateId });

      expect((await embedPolicyFor(api.database.db, inquiryId))?.['frame-ancestors']).toEqual([
        SHOP,
      ]);
    });
  });

  describe('a redirect-uri on POST /inquiries (C158.4)', () => {
    it('takes a URI on the embed origins while no redirect origins are set, and refuses another without echoing it', async () => {
      await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
      const templateId = await createTemplate(api);

      const accepted = await createWithRedirect(templateId, `${SHOP}/done`);
      const refused = await createWithRedirect(templateId, 'https://other.example.com/done');

      expect(accepted.statusCode, accepted.body).toBe(201);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json()).toMatchObject({
        code: 'redirect_uri_not_allowed',
        errors: [{ pointer: '/data/attributes/redirect-uri' }],
      });
      expect(refused.body).not.toContain('other.example.com');
    });

    it('reads allowed-redirect-origins over the embed origins once set', async () => {
      await setSettings(api.environmentId, {
        'allowed-embed-origins': [SHOP],
        'allowed-redirect-origins': [PAY],
      });
      const templateId = await createTemplate(api);

      expect((await createWithRedirect(templateId, `${PAY}/done`)).statusCode).toBe(201);
      expect((await createWithRedirect(templateId, `${SHOP}/done`)).statusCode).toBe(422);
    });

    it('takes a custom scheme the pinned version lists', async () => {
      await setSettings(api.environmentId, {});
      const templateId = await createTemplate(api);
      await setVersion(templateId, { redirectUriSchemes: ['myapp'] });

      expect((await createWithRedirect(templateId, 'myapp://verified')).statusCode).toBe(201);
      await expect(
        checkInquiryRedirectUri(api.database.db, {
          environmentId: api.environmentId,
          environmentKind: 'sandbox',
          versionId: await versionOf(templateId),
          redirectUri: 'otherapp://verified',
        }),
      ).rejects.toMatchObject({ code: 'redirect_uri_not_allowed' });
    });
  });

  describe('redirectUrlFor (C158.4, C158.5)', () => {
    it("builds the inquiry's own redirect, then the version's, with status only when opted in", async () => {
      await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP, PAY] });
      const templateId = await createTemplate(api);
      const own = await createWithRedirect(templateId, `${SHOP}/done`);
      expect(own.statusCode, own.body).toBe(201);
      const ownId = own.json<{ data: { id: string } }>().data.id;
      const plainId = await createInquiry(api, { templateId });
      await setVersion(templateId, { redirectUri: `${PAY}/back` });

      expect(
        await redirectUrlFor(api.database.db, {
          inquiry: await inquiryRow(ownId),
          environmentKind: 'sandbox',
          status: 'completed',
        }),
      ).toBe(`${SHOP}/done?inquiry-id=${ownId}`);
      expect(
        await redirectUrlFor(api.database.db, {
          inquiry: await inquiryRow(plainId),
          environmentKind: 'sandbox',
          status: 'completed',
        }),
      ).toBe(`${PAY}/back?inquiry-id=${plainId}`);

      await setVersion(templateId, { redirectIncludeStatus: true });
      expect(
        await redirectUrlFor(api.database.db, {
          inquiry: await inquiryRow(plainId),
          environmentKind: 'sandbox',
          status: 'failed',
        }),
      ).toBe(`${PAY}/back?inquiry-id=${plainId}&status=failed`);
    });

    it('checks the current lists on every answer: a removed origin stops the redirect', async () => {
      await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
      const templateId = await createTemplate(api);
      const created = await createWithRedirect(templateId, `${SHOP}/done`);
      expect(created.statusCode, created.body).toBe(201);
      const inquiryId = created.json<{ data: { id: string } }>().data.id;
      await setSettings(api.environmentId, { 'allowed-embed-origins': [PAY] });

      expect(
        await redirectUrlFor(api.database.db, {
          inquiry: await inquiryRow(inquiryId),
          environmentKind: 'sandbox',
          status: 'completed',
        }),
      ).toBeNull();
    });

    it('answers null when neither the inquiry nor the version names a redirect', async () => {
      const inquiryId = await createInquiry(api);

      expect(
        await redirectUrlFor(api.database.db, {
          inquiry: await inquiryRow(inquiryId),
          environmentKind: 'sandbox',
          status: 'completed',
        }),
      ).toBeNull();
    });
  });
});
