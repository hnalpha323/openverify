import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_ERROR_WORDS } from '../../../../components/lists/list-words';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { LIST_IDS, importer } from '../../../../testing/lists-fixtures';
import { IMPORTERS_PATH, serveImporter } from '../../../../testing/routes/lists';
import ImporterPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

const ERRORS = `${IMPORTERS_PATH}/${LIST_IDS.importer}/errors`;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['importers:read'] });
});

afterEach(() => {
  api.restore();
});

const page = async (id: string = LIST_IDS.importer, params: Record<string, string> = {}) =>
  render(
    await ImporterPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(params) }),
  );

describe('one list import (C100, C108)', () => {
  it('shows an errored import with its counts, and each error as a code, a row and a column', async () => {
    expect(metadata.title).toBe('List import');
    serveImporter(
      api,
      importer('email-address', { status: 'errored', errorCount: 2, rowCount: 3 }),
    );

    await page();

    expect(
      screen.getByRole('heading', { level: 1, name: `Import ${LIST_IDS.importer}` }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'The list' })).toHaveAttribute(
      'href',
      `/lists/${LIST_IDS.list}`,
    );
    const summary = screen.getByRole('region', { name: 'Progress' });
    expect(within(summary).getByText('Errored')).toBeVisible();
    expect(
      within(summary).getByText(
        'All or nothing: one refused row refuses the whole file, so no row of it was imported.',
      ),
    ).toBeVisible();
    const errors = screen.getByRole('table', { name: 'Errors' });
    const rows = within(errors).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => within(row));
    if (first === undefined || second === undefined) {
      throw new Error('two error rows');
    }
    expect(first.getByText('The whole file')).toBeVisible();
    expect(first.getByText(IMPORT_ERROR_WORDS.missing_column)).toBeVisible();
    expect(second.getByText('4')).toBeVisible();
    expect(second.getByText('value')).toBeVisible();
    expect(second.getByText('invalid_value')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download the errors as CSV' })).toHaveAttribute(
      'href',
      `/lists/importers/${LIST_IDS.importer}/errors.csv`,
    );
    expect(Object.fromEntries(api.find('GET', ERRORS)?.query ?? [])).toEqual({
      'page[size]': '100',
    });
  });

  it('says a pending import is still running, and a ready one what it imported', async () => {
    serveImporter(api, importer('email-address', { status: 'pending' }), []);
    const { unmount } = await page();
    expect(screen.getByText('Importing')).toBeVisible();
    expect(screen.getByText('No errors recorded so far.')).toBeVisible();
    unmount();

    serveImporter(
      api,
      importer('email-address', {
        status: 'ready',
        mode: 'skip-invalid',
        rowCount: 5,
        successfulCount: 2,
        duplicateCount: 1,
        alreadyPresentCount: 1,
        errorCount: 1,
      }),
      [{ row: 3, column: 'value', code: 'invalid_value' }],
    );
    await page();
    const summary = screen.getByRole('region', { name: 'Progress' });
    expect(within(summary).getByText('Imported')).toBeVisible();
    expect(
      within(summary).getByText(
        '2 of 5 rows imported; 1 repeated in the file; 1 already in the list; 1 error',
      ),
    ).toBeVisible();
  });

  it('pages the errors by row', async () => {
    serveImporter(
      api,
      importer('email-address', { status: 'errored', errorCount: 150 }),
      [{ row: 101, column: 'value', code: 'invalid_value' }],
      `/api/v1/importers/${LIST_IDS.importer}/errors?page%5Bafter%5D=101`,
    );

    await page(LIST_IDS.importer, { after: '100' });

    expect(Object.fromEntries(api.find('GET', ERRORS)?.query ?? [])).toEqual({
      'page[size]': '100',
      'page[after]': '100',
    });
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/lists/importers/${LIST_IDS.importer}?after=101`,
    );
  });

  it('shows the forbidden panel without importers:read', async () => {
    api.me({ permissions: ['lists:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
