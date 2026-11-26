import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LIST_KINDS } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIST_KIND_LABELS } from '../../../components/lists/list-words';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { SETTINGS_PATH, serveListSettings } from '../../../testing/routes/lists';
import NewListPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['lists:read', 'lists:write'] });
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>{await NewListPage({ searchParams: Promise.resolve(params) })}</ToastProvider>,
  );

describe('creating a list (C97.1, C108)', () => {
  it('is titled Create a list, and offers every kind', async () => {
    expect(metadata.title).toBe('Create a list');

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Create a list' })).toBeVisible();
    const kind = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Type' });
    expect([...kind.options].map((option) => option.value)).toEqual([...LIST_KINDS]);
    expect(within(kind).getByRole('option', { name: LIST_KIND_LABELS.field })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Name/u })).toBeRequired();
    expect(screen.getByRole('checkbox', { name: 'Screen at inquiry completion' })).toBeChecked();
    expect(api.find('GET', SETTINGS_PATH)).toBeUndefined();
  });

  it('asks each kind for its own settings: the field key, fuzzy first names, the phone region, case and compromised IDs', async () => {
    const user = userEvent.setup();
    await page({ kind: 'field' });

    expect(screen.getByRole('textbox', { name: /^Field key/u })).toBeRequired();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'name');
    expect(screen.queryByRole('textbox', { name: /^Field key/u })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Match first names fuzzily' })).not.toBeChecked();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'phone-number');
    expect(screen.getByRole('textbox', { name: /^Default region/u })).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'string');
    expect(screen.getByRole('checkbox', { name: 'Case-sensitive' })).not.toBeChecked();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Type' }),
      'government-id-number',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Use for the compromised ID check' }),
    ).not.toBeChecked();
  });

  it('reads the acknowledgement with settings:read, and says a face list needs its retention within the face window', async () => {
    api.me({ permissions: ['lists:read', 'lists:write', 'settings:read'] });
    serveListSettings(api, 'Synthetic basis: fraud prevention under our DPIA.', 180);

    await page({ kind: 'face' });

    const state = screen.getByRole('region', { name: 'Face and background lists' });
    expect(state).toHaveTextContent('Acknowledged');
    expect(state).toHaveTextContent('Synthetic basis: fraud prevention under our DPIA.');
    const retention = screen.getByRole('spinbutton', { name: /^Item retention \(days\)/u });
    expect(retention).toBeRequired();
    expect(retention).toHaveAttribute('max', '180');
    expect(retention).toHaveAccessibleDescription(
      'Required for a face or background list: at most 180 days, the face template retention of this environment, which the source consent promises.',
    );
  });

  it('says a face or background list is refused until an administrator records the basis', async () => {
    api.me({ permissions: ['lists:read', 'lists:write', 'settings:read'] });
    serveListSettings(api, null);

    await page({ kind: 'selfie-background' });

    expect(screen.getByRole('region', { name: 'Face and background lists' })).toHaveTextContent(
      'Not acknowledged. Creating a face or background list is refused (biometric_lists_not_acknowledged) until an administrator records the basis for biometric lists in Settings.',
    );
  });

  it('says what the API answers when the operator cannot read the setting', async () => {
    await page({ kind: 'face' });

    expect(api.find('GET', SETTINGS_PATH)).toBeUndefined();
    expect(screen.getByRole('region', { name: 'Face and background lists' })).toHaveTextContent(
      'Creating a face or background list is refused (biometric_lists_not_acknowledged) until an administrator records the basis for biometric lists in Settings. Reading that setting needs settings:read.',
    );
  });

  it('shows the forbidden panel without lists:write', async () => {
    api.me({ permissions: ['lists:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
