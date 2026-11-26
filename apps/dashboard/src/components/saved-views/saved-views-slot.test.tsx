import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlotData } from '../../app/exports/saved-views/route';
import { ANALYTICS_IDS } from '../../testing/routes/analytics';
import { SAVED_VIEWS_ROUTE, SavedViewsSlot } from './saved-views-slot';

const navigation = vi.hoisted(() => ({ search: '', pathname: '/inquiries' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./actions', () => ({
  createSavedViewAction: vi.fn(),
  updateSavedViewAction: vi.fn(),
  deleteSavedViewAction: vi.fn(),
  copySavedViewAction: vi.fn(),
}));

const view = (overrides: Partial<SlotData['views'][number]> = {}): SlotData['views'][number] => ({
  id: ANALYTICS_IDS.view,
  name: 'Failed this month',
  mine: true,
  shared: false,
  filters: { 'filter[status]': 'failed' },
  filtersValid: true,
  invalidFilters: [],
  ...overrides,
});

let fetch: ReturnType<typeof vi.fn>;

function serve(data: SlotData | null, status = 200) {
  fetch = vi
    .fn()
    .mockResolvedValue(
      data === null ? new Response(null, { status }) : Response.json(data, { status }),
    );
  vi.stubGlobal('fetch', fetch);
}

beforeEach(() => {
  navigation.search = '';
  navigation.pathname = '/inquiries';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const item = (name: string) =>
  within(screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement);

describe('the saved-views slot of a list page (C165.1, C165.5)', () => {
  it('reads the list’s views by its name only, and applies one through the page’s own URL', async () => {
    navigation.search = 'status=failed&reference-id=synthetic-ref-001';
    serve({
      views: [
        view(),
        view({ id: ANALYTICS_IDS.sharedView, name: 'Team view', mine: false, shared: true }),
      ],
      exportType: 'inquiries',
    });

    render(<SavedViewsSlot list="inquiries" />);

    const mine = await screen.findByText('Failed this month', { selector: 'span' });
    expect(fetch).toHaveBeenCalledWith(`${SAVED_VIEWS_ROUTE}?list=inquiries`, expect.anything());
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('synthetic-ref-001');
    expect(mine).toBeVisible();
    expect(
      item('Failed this month').getByRole('link', { name: 'Apply Failed this month' }),
    ).toHaveAttribute('href', '/inquiries?status=failed');
    expect(
      item('Failed this month').getByRole('link', { name: 'Export its rows: Failed this month' }),
    ).toHaveAttribute('href', `/exports?view=${ANALYTICS_IDS.view}&type=inquiries`);
    expect(
      item('Failed this month').getByRole('button', { name: 'Delete Failed this month' }),
    ).toBeVisible();
    const shared = item('Team view');
    expect(shared.getByText('(shared by another user)')).toBeVisible();
    expect(shared.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(shared.getByRole('button', { name: 'Copy to change: Team view' })).toBeVisible();
  });

  it('refuses to save a personal-data filter in words, and puts its value in no form', async () => {
    navigation.search = 'status=failed&reference-id=synthetic-ref-001';
    serve({ views: [], exportType: null });

    const { container } = render(<SavedViewsSlot list="inquiries" />);

    expect(
      await screen.findByText(/Remove the filters filter\[reference-id\] first/),
    ).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Save these filters as a view' })).toBeNull();
    expect(container.innerHTML).not.toContain('synthetic-ref-001');
  });

  it('never applies a view the list no longer accepts, or one the page cannot show', async () => {
    serve({
      views: [
        view({
          filtersValid: false,
          invalidFilters: ['filter[old]'],
          filters: { 'filter[old]': 'x' },
        }),
        view({
          id: ANALYTICS_IDS.sharedView,
          name: 'Odd view',
          filters: { 'filter[unknown]': 'x' },
        }),
      ],
      exportType: null,
    });

    render(<SavedViewsSlot list="inquiries" />);

    const invalid = item(
      (await screen.findAllByText('Failed this month', { selector: 'span' }))[0]?.textContent ?? '',
    );
    expect(invalid.queryByRole('link', { name: /Apply/ })).toBeNull();
    expect(
      invalid.getByText(/no longer accepted by this list \(filter\[old\]\), so it is not applied/),
    ).toBeVisible();
    expect(
      item('Odd view').getByText(/cannot show its filters filter\[unknown\], so it is not applied/),
    ).toBeVisible();
  });

  it('offers to save the current filters, naming the ones a view cannot keep', async () => {
    navigation.pathname = '/reports';
    navigation.search = 'type=watchlist&result=match';
    serve({ views: [], exportType: null });

    render(<SavedViewsSlot list="reports" />);

    const save = within(await screen.findByRole('form', { name: 'Save these filters as a view' }));
    expect(save.getByText('Not kept in a view: result.')).toBeVisible();
    expect(screen.getByText('No saved views of this list yet.')).toBeVisible();
    expect(save.getByDisplayValue<HTMLInputElement>('{"filter[type]":"watchlist"}').type).toBe(
      'hidden',
    );
  });

  it('applies a webhook’s view at the page’s own path', async () => {
    navigation.pathname = '/webhooks/wbh_01JF0000000000000000000020';
    serve({ views: [view()], exportType: null });

    render(<SavedViewsSlot list="webhook-deliveries" />);

    expect(await screen.findByRole('link', { name: 'Apply Failed this month' })).toHaveAttribute(
      'href',
      '/webhooks/wbh_01JF0000000000000000000020?status=failed',
    );
  });

  it('says in one line when the views cannot be read, and renders nothing while loading', async () => {
    serve(null, 403);
    const { container } = render(<SavedViewsSlot list="inquiries" />);
    expect(container.textContent).toBe('');
    expect(await screen.findByText('Saved views could not be loaded.')).toBeVisible();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    render(<SavedViewsSlot list="events" />);
    await waitFor(() => {
      expect(screen.getAllByText('Saved views could not be loaded.')).toHaveLength(2);
    });
  });
});

describe('a transaction field filter in the slot (DA4; K9-19)', () => {
  it('offers to save a filter on a field the console knows is not a string', async () => {
    navigation.pathname = '/transactions';
    navigation.search = 'field.amount=100';
    serve({ views: [], exportType: null, nonPersonalTransactionFields: ['amount'] });

    render(<SavedViewsSlot list="transactions" />);

    expect(await screen.findByRole('form', { name: 'Save these filters as a view' })).toBeVisible();
    expect(screen.queryByText(/Remove the filters/)).toBeNull();
  });

  it.each([
    ['the field is not among them', ['other']],
    ['they could not be told', null],
  ])('refuses it in words when %s', async (_case, fields) => {
    navigation.pathname = '/transactions';
    navigation.search = 'field.amount=100';
    serve({ views: [], exportType: null, nonPersonalTransactionFields: fields });

    render(<SavedViewsSlot list="transactions" />);

    expect(
      await screen.findByText(/Remove the filters filter\[fields\.amount\] first/),
    ).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Save these filters as a view' })).toBeNull();
  });
});
