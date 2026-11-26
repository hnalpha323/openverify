import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { TEMPLATE_FORMS_COPY } from '../../../lib/copy/template-forms';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { CONFIG_EDITOR, CONFIG_VIEWER } from '../../../testing/routes/report-config';
import { serveLists } from '../../../testing/routes/template-forms';
import NewReportTemplatePage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const COPY = TEMPLATE_FORMS_COPY.reportForms;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveLists(api, []);
});

afterEach(() => {
  api.restore();
});

describe('the new report template page (C153.4, K14)', () => {
  it('offers the create form to a writer', async () => {
    api.me({ permissions: CONFIG_EDITOR });

    render(<ToastProvider>{await NewReportTemplatePage()}</ToastProvider>);

    expect(metadata.title).toBe(COPY.newTitle);
    expect(screen.getByRole('heading', { level: 1, name: COPY.newTitle })).toBeVisible();
    expect(screen.getByRole('form', { name: COPY.newTitle })).toBeVisible();
    expect(screen.getByRole('link', { name: COPY.breadcrumb })).toHaveAttribute(
      'href',
      '/report-templates',
    );
  });

  it('shows the forbidden panel without report-templates:write', async () => {
    api.me({ permissions: CONFIG_VIEWER });

    render(<ToastProvider>{await NewReportTemplatePage()}</ToastProvider>);

    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText(/report-templates:write/)).toBeVisible();
  });
});
