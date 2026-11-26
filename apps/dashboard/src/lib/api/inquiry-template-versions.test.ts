// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, draft, single, version } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import {
  diffTemplateVersions,
  isPreconditionFailed,
  publishTemplateVersion,
  retrieveTemplateVersion,
  updateTemplateVersion,
  validateTemplateVersion,
} from './inquiry-template-versions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const ETAG = `"${'a'.repeat(64)}"`;
const NEXT_ETAG = `"${'b'.repeat(64)}"`;
const DRAFT_PATH = `/api/v1/inquiry-template-versions/${IDS.draft}`;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the template version client (C154, Workflow 9C)', () => {
  it('reads a version with the strong ETag it is served with', async () => {
    api.reply(200, single(draft()), { etag: ETAG });

    const { version: read, etag } = await retrieveTemplateVersion(IDS.draft);

    expect(read.id).toBe(IDS.draft);
    expect(etag).toBe(ETAG);
    expect(api.last()).toMatchObject({ method: 'GET', path: DRAFT_PATH });
  });

  it('refuses a version served without an ETag, so no save can skip If-Match', async () => {
    api.reply(200, single(draft()));

    await expect(retrieveTemplateVersion(IDS.draft)).rejects.toThrow(/ETag/);
  });

  it('saves a draft with If-Match and allow-invalid, answering its new ETag (C154.2, C154.3)', async () => {
    api.reply(200, single(draft({ description: 'Synthetic' })), { etag: NEXT_ETAG });

    const saved = await updateTemplateVersion(IDS.draft, { description: 'Synthetic' }, ETAG);

    expect(saved.etag).toBe(NEXT_ETAG);
    expect(api.last()).toMatchObject({ method: 'PATCH', path: DRAFT_PATH });
    expect(api.last().headers.get('if-match')).toBe(ETAG);
    expect(api.last().body).toEqual({
      data: { type: 'inquiry-template-version', attributes: { description: 'Synthetic' } },
      meta: { 'allow-invalid': true },
    });
  });

  it('tells a 412 precondition_failed apart from every other problem', async () => {
    api.replyProblem(412, undefined, { code: 'precondition_failed' });

    const failure = await updateTemplateVersion(IDS.draft, { description: 'x' }, ETAG).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(OpenVerifyApiError);
    expect(isPreconditionFailed(failure)).toBe(true);
    expect(isPreconditionFailed(new Error('412'))).toBe(false);
    api.replyProblem(422, undefined, { code: 'definition_invalid' });
    expect(
      isPreconditionFailed(
        await updateTemplateVersion(IDS.draft, { description: 'x' }, ETAG).catch(
          (error: unknown) => error,
        ),
      ),
    ).toBe(false);
  });

  it('publishes with If-Match, the acknowledgements and the note (C154.9)', async () => {
    api.reply(200, single(version({}, IDS.draft)), { etag: NEXT_ETAG });

    const published = await publishTemplateVersion(
      IDS.draft,
      { acknowledgements: ['fallback:s_aaaaaaaa'], publishNote: 'Synthetic note' },
      ETAG,
    );

    expect(published.version.attributes.status).toBe('published');
    expect(api.last()).toMatchObject({ method: 'POST', path: `${DRAFT_PATH}/publish` });
    expect(api.last().headers.get('if-match')).toBe(ETAG);
    expect(api.last().body).toEqual({
      meta: { acknowledgements: ['fallback:s_aaaaaaaa'], 'publish-note': 'Synthetic note' },
    });
  });

  it('publishes without a note or acknowledgement as an empty meta', async () => {
    api.reply(200, single(version({}, IDS.draft)), { etag: NEXT_ETAG });

    await publishTemplateVersion(IDS.draft, { acknowledgements: [] }, ETAG);

    expect(api.last().body).toEqual({ meta: {} });
  });

  it('validates the stored draft, or an unsaved body, in a mode (C154.4)', async () => {
    const answer = {
      data: {
        type: 'inquiry-template-version-validation',
        id: IDS.draft,
        attributes: {
          validation: {
            status: 'invalid',
            problems: [
              {
                pointer: '/flow/steps/1',
                code: 'step_unreachable',
                detail: 'Synthetic.',
                severity: 'error',
              },
            ],
          },
          'flow-sha256': null,
          'acknowledgements-required': ['fallback:s_aaaaaaaa'],
        },
      },
    };
    api.reply(200, answer).reply(200, answer);

    const stored = await validateTemplateVersion(IDS.draft, { mode: 'publish' });
    expect(stored.validation.status).toBe('invalid');
    expect(stored['acknowledgements-required']).toEqual(['fallback:s_aaaaaaaa']);
    expect(api.requests[0]).toMatchObject({ method: 'POST', path: `${DRAFT_PATH}/validate` });
    expect(api.requests[0]?.body).toEqual({ meta: { mode: 'publish' } });

    await validateTemplateVersion(IDS.draft, { attributes: { description: 'x' } });
    expect(api.requests[1]?.body).toEqual({
      data: { type: 'inquiry-template-version', attributes: { description: 'x' } },
    });
  });

  it('reads the diff of a version against another (C154.6)', async () => {
    api.reply(200, {
      data: {
        type: 'inquiry-template-version-diff',
        id: `${IDS.draft}..${IDS.version}`,
        attributes: {
          'from-version-id': IDS.draft,
          'to-version-id': IDS.version,
          steps: { added: ['s_aaaaaaaa'], removed: [], changed: [] },
          edges: { added: [], removed: [], retargeted: [] },
          'route-order': [],
          'verification-config': [],
          settings: [],
          'report-config': [],
          'field-schemas': [],
          copy: [],
          'theme-set-id': null,
          locales: [],
          'layout-only': false,
          consequences: [],
        },
      },
    });

    const diff = await diffTemplateVersions(IDS.draft, IDS.version);

    expect(diff.steps.added).toEqual(['s_aaaaaaaa']);
    expect(api.last()).toMatchObject({ method: 'GET', path: `${DRAFT_PATH}/diff` });
    expect(Object.fromEntries(api.last().query)).toEqual({ against: IDS.version });
  });

  it('encodes the version id it is given', async () => {
    api.reply(200, single(draft()), { etag: ETAG });

    await retrieveTemplateVersion('itmplv_a/b');

    expect(api.last().path).toBe('/api/v1/inquiry-template-versions/itmplv_a%2Fb');
  });
});
