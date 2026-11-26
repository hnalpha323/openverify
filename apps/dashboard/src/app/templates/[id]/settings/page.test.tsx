import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_MEMBER_KEYS } from '../../../../components/schema-form/template-members';
import { ToastProvider } from '../../../../components/toasts';
import { TEMPLATE_FORMS_COPY } from '../../../../lib/copy/template-forms';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  draft,
  template,
  version,
} from '../../../../testing/lifecycle-fixtures';
import { expectNotFound } from '../../../../testing/next-errors';
import { rscPayloadOf } from '../../../../testing/rsc-payload';
import {
  TEMPLATE_EDITOR,
  TEMPLATE_READER,
  etagOf,
  serveLists,
  serveTemplateVersions,
} from '../../../../testing/routes/template-forms';
import TemplateSettingsPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const COPY = TEMPLATE_FORMS_COPY.settingsPage;
const SYNTHETIC_DEFAULT = 'synthetic-default-never-sent';
let api: RouteApi;

/** A draft with the 9A members, a PII field default and a saved publish problem. */
const DRAFT = draft({
  'field-schemas': [
    { key: 'nickname', type: 'string', label: 'Nickname', pii: true, default: SYNTHETIC_DEFAULT },
  ],
  'embed-origins': ['https://partner.example.com'],
  'redirect-uri': null,
  'redirect-uri-schemes': [],
  'redirect-include-status': false,
  'help-url': null,
  'privacy-url': null,
  description: null,
  validation: {
    status: 'invalid',
    problems: [
      {
        pointer: '/embed-origins/0',
        code: 'embed_origin_invalid',
        detail: 'not one of the allowed embed origins',
        severity: 'error',
      },
    ],
  },
});

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveLists(api, []);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.template, query: Record<string, string> = {}) =>
  TemplateSettingsPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });

async function renderSettings(id?: string, query?: Record<string, string>) {
  render(<ToastProvider>{await page(id, query)}</ToastProvider>);
}

describe('the template settings tab (C153.3)', () => {
  it('is titled for the browser', () => {
    expect(metadata.title).toBe(COPY.metadataTitle);
  });

  it('edits the template’s draft when one exists, under its breadcrumbs and tabs', async () => {
    api.me({ permissions: TEMPLATE_EDITOR });
    serveTemplateVersions(api, template(), [DRAFT, version()]);

    await renderSettings();

    expect(screen.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Synthetic ID and selfie' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}`,
    );
    const tabs = screen.getByRole('navigation', { name: 'Template sections' });
    expect(within(tabs).getByRole('link', { current: 'page' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/settings`,
    );
    expect(screen.getByText(COPY.versionDraft(2))).toBeVisible();
  });

  it('offers a form per member and for the verification checks, each saving with the draft’s ETag', async () => {
    api.me({ permissions: TEMPLATE_EDITOR });
    serveTemplateVersions(api, template(), [DRAFT, version()]);

    await renderSettings();

    for (const member of FORM_MEMBER_KEYS) {
      const form = screen.getByRole('form', { name: TEMPLATE_FORMS_COPY.members[member] });
      expect(form.querySelector('input[name="etag"]')).toHaveValue(etagOf(DRAFT));
    }
    expect(
      screen.getByRole('form', { name: TEMPLATE_FORMS_COPY.verificationConfig.legend }),
    ).toBeVisible();
  });

  it('shows the saved draft’s publish problems at their fields', async () => {
    api.me({ permissions: TEMPLATE_EDITOR });
    serveTemplateVersions(api, template(), [DRAFT, version()]);

    await renderSettings();

    const links = screen.getByRole('form', { name: TEMPLATE_FORMS_COPY.members.links });
    expect(
      within(links).getByRole('textbox', { name: 'embed-origins' }),
    ).toHaveAccessibleDescription(/not one of the allowed embed origins/);
  });

  it('shows the current version read-only when the template has no draft', async () => {
    api.me({ permissions: TEMPLATE_EDITOR });
    serveTemplateVersions(api, template(), [version()]);

    await renderSettings();

    expect(screen.getByText(COPY.versionReadOnly(1))).toBeVisible();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('group', { name: TEMPLATE_FORMS_COPY.members.settings })).toBeVisible();
  });

  it('opens the version the query names, when it is the template’s', async () => {
    api.me({ permissions: TEMPLATE_EDITOR });
    serveTemplateVersions(api, template(), [DRAFT, version()]);

    await renderSettings(IDS.template, { version: IDS.version });

    expect(screen.getByText(COPY.versionReadOnly(1))).toBeVisible();
  });

  it('says a reader cannot change a draft, and offers no form', async () => {
    api.me({ permissions: TEMPLATE_READER });
    serveTemplateVersions(api, template(), [DRAFT, version()]);

    await renderSettings();

    expect(screen.getByText(COPY.versionNoWrite(2))).toBeVisible();
    expect(screen.queryByRole('form')).toBeNull();
    expect(api.find('GET', '/lists')).toBeUndefined();
  });

  it('sends the browser no field schema: no initial value reaches the RSC payload (C149.4)', async () => {
    api.me({ permissions: TEMPLATE_READER });
    serveTemplateVersions(api, template(), [DRAFT, version()]);

    const payload = await rscPayloadOf(await page());

    expect(payload).not.toContain(SYNTHETIC_DEFAULT);
    expect(payload).not.toContain('field-schemas');
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('itmpl_x'));

    expect(api.requests).toHaveLength(0);
  });
});
