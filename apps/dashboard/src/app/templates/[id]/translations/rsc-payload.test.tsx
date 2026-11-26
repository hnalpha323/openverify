import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { LIFECYCLE_IDS, draft, template, version } from '../../../../testing/lifecycle-fixtures';
import { rscPayloadOf } from '../../../../testing/rsc-payload';
import {
  COPY_EDITOR,
  serveTemplateWithVersions,
  serveTranslations,
  translationRow,
} from '../../../../testing/routes/themes-copy';
import TemplateTranslationsPage from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;
const ID = LIFECYCLE_IDS.template;
const DEFAULT_VALUE = 'SYNTHETIC-FIELD-DEFAULT-0001';

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('the translations tab’s RSC payload (rule 11)', () => {
  it('carries the texts and their rules, never a template field’s initial value, for a principal without pii:view', async () => {
    api.me({ permissions: COPY_EDITOR });
    serveTemplateWithVersions(api, template(), [
      version(),
      draft({
        'field-schemas': [
          {
            key: 'given_name',
            type: 'string',
            label: 'Given name',
            pii: true,
            default: DEFAULT_VALUE,
          },
        ],
      } as never),
    ]);
    serveTranslations(api, [translationRow('completion.title', { en: 'Synthetic done' })], ID);

    const payload = await rscPayloadOf(
      await TemplateTranslationsPage({
        params: Promise.resolve({ id: ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(payload).toContain('Synthetic done');
    expect(payload).toContain('completion.title');
    expect(payload).not.toContain(DEFAULT_VALUE);
  });
});
