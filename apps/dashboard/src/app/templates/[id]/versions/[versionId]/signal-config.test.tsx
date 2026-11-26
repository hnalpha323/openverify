import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  single,
  template,
  version,
} from '../../../../../testing/lifecycle-fixtures';
import VersionPage from './page';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiry-templates:read'] });
  api.on('GET', `/inquiry-templates/${IDS.template}`, 200, single(template()));
  api.on(
    'GET',
    `/inquiry-template-versions/${IDS.version}`,
    200,
    single(
      version({
        'signal-config': { collect: 'default', 'on-signal': 'none', 'review-rules': [] },
        'list-config': { screen: 'all', 'on-list-match': 'needs_review' },
      }),
    ),
  );
});

afterEach(() => {
  api.restore();
});

describe('a published version shows signal-config and list-config read-only (C108)', () => {
  it('shows both documents as the version serves them', async () => {
    render(
      <ToastProvider>
        {await VersionPage({
          params: Promise.resolve({ id: IDS.template, versionId: IDS.version }),
        })}
      </ToastProvider>,
    );

    expect(screen.getByRole('region', { name: 'Signal config' })).toHaveTextContent(
      '"on-signal": "none"',
    );
    expect(screen.getByRole('region', { name: 'List config' })).toHaveTextContent(
      '"on-list-match": "needs_review"',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
