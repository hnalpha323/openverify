import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  draft,
  single,
  template,
  version,
} from '../../../../testing/lifecycle-fixtures';
import { expectNotFound } from '../../../../testing/next-errors';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { PREVIEW_COPY } from '../../../../lib/copy/preview';
import { simulationSubjectsOf } from '../../../../components/flow-preview/simulation-subjects';
import { rscPayloadOf } from '../../../../testing/rsc-payload';
import {
  PRESETS_PATH,
  builtinPreset,
  ownPreset,
  presetList,
} from '../../../../testing/routes/preview';
import { VERSION_CONTENT } from '../../../../testing/lifecycle-fixtures';
import TemplatePreviewPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./actions', () => ({
  resolvePreview: vi.fn(() => new Promise(() => undefined)),
  runSimulation: vi.fn(() => new Promise(() => undefined)),
  savePreset: vi.fn(() => new Promise(() => undefined)),
  removePreset: vi.fn(() => new Promise(() => undefined)),
}));

const TEMPLATE = `/inquiry-templates/${IDS.template}`;

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiry-templates:read'] });
  api.on('GET', TEMPLATE, 200, single(template()));
  api.on('GET', '/inquiry-template-versions', 200, {
    data: [draft(), version()],
    links: { next: null },
  });
  api.on('GET', `/inquiry-template-versions/${IDS.draft}`, 200, single(draft()));
  api.on('GET', `/inquiry-template-versions/${IDS.version}`, 200, single(version()));
  api.on('GET', PRESETS_PATH, 200, presetList([builtinPreset('selfie', 'failed'), ownPreset()]));
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.template, searchParams: Record<string, string> = {}) =>
  TemplatePreviewPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });

describe('the template preview page (C156)', () => {
  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe(PREVIEW_COPY.page.metadataTitle);
  });

  it('previews the newest draft by default, and says what differs from a live flow', async () => {
    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: PREVIEW_COPY.page.title })).toBeVisible();
    expect(screen.getByText('Version 2')).toBeVisible();
    const banner = screen.getByRole('region', { name: PREVIEW_COPY.banner.heading });
    for (const item of Object.values(PREVIEW_COPY.banner.items)) {
      expect(within(banner).getByText(item)).toBeVisible();
    }
  });

  it('is the template’s preview section, with the frame and its settings', async () => {
    vi.stubEnv('OPENVERIFY_FLOW_PUBLIC_URL', 'http://127.0.0.1:5173/');
    render(await page());

    const sections = screen.getByRole('navigation', { name: 'Template sections' });
    expect(within(sections).getByRole('link', { current: 'page' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/preview`,
    );
    expect(screen.getByLabelText(PREVIEW_COPY.controls.locale)).toBeVisible();
    expect(screen.getByTitle(PREVIEW_COPY.frame.title)).toHaveAttribute(
      'src',
      'http://127.0.0.1:5173/preview',
    );
  });

  it('shows the configuration error without a flow origin', async () => {
    vi.stubEnv('OPENVERIFY_FLOW_PUBLIC_URL', '');
    render(await page());

    expect(screen.getByRole('alert')).toHaveTextContent(PREVIEW_COPY.frame.notConfigured);
  });

  it('offers simulate with the presets and the version’s verification steps', async () => {
    render(await page());

    const simulate = screen.getByRole('region', { name: PREVIEW_COPY.simulate.heading });
    const presets = within(simulate).getByLabelText(PREVIEW_COPY.simulate.preset);
    expect(within(presets).getAllByRole('option')).toHaveLength(3);
    const [first] = simulationSubjectsOf(VERSION_CONTENT.flow).verifications;
    expect(first).toBeDefined();
    expect(
      within(simulate).getByLabelText(
        `${first?.id ?? ''}: ${PREVIEW_COPY.simulate.verificationStatus}`,
      ),
    ).toBeVisible();
  });

  it('sends the browser no preset values and no step configuration without pii:view (C174.5)', async () => {
    api.me({ permissions: ['inquiry-templates:read'] });
    api.on('GET', PRESETS_PATH, 200, presetList([ownPreset(null)]));
    api.on('GET', '/inquiry-template-versions', 200, {
      data: [draft({ description: 'SYNTHETIC-CANARY-DESCRIPTION' }), version()],
      links: { next: null },
    });

    const payload = await rscPayloadOf(await page());

    expect(payload).not.toContain('SYNTHETIC-CANARY');
    expect(payload).not.toContain('verification-config');
    expect(payload).toContain('"scope":null');
    expect(payload).not.toContain('"scope":{');
  });

  it('previews the version the URL names', async () => {
    render(await page(IDS.template, { version: IDS.version }));

    expect(screen.getByText('Version 1')).toBeVisible();
  });

  it('answers not found for a malformed template or version id', async () => {
    await expectNotFound(page('itmpl_../x'));
    await expectNotFound(page(IDS.template, { version: 'itmplv_../x' }));
  });

  it('answers not found for a version of another template', async () => {
    api.on(
      'GET',
      `/inquiry-template-versions/${IDS.version}`,
      200,
      single({
        ...version(),
        relationships: {
          'inquiry-template': {
            data: { type: 'inquiry-template', id: 'itmpl_01JB0000000000000000000009' },
          },
        },
      }),
    );

    await expectNotFound(page(IDS.template, { version: IDS.version }));
  });

  it('shows the forbidden panel without inquiry-templates:read, calling nothing else', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByText(/inquiry-templates:read/)).toBeVisible();
    expect(api.all('GET', TEMPLATE)).toEqual([]);
  });
});
