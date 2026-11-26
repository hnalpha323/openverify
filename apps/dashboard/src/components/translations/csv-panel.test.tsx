import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import { CsvPanel } from './csv-panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

function upload() {
  const input = screen.getByLabelText('CSV file');
  fireEvent.change(input, {
    target: { files: [new File(['step,component,attribute,en'], 'translations.csv')] },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Import CSV' }));
}

describe('CsvPanel (C162.7)', () => {
  it('posts the file to the console route and reports the import', async () => {
    const fetch = answer(200, { imported: 3 });
    vi.stubGlobal('fetch', fetch);
    render(<CsvPanel templateId={THEME_IDS.template} canWrite />);

    upload();

    await waitFor(() => {
      expect(screen.getByText(/now holds 3 reworded texts/)).toBeVisible();
    });
    expect(fetch).toHaveBeenCalledWith(
      `/templates/${THEME_IDS.template}/translations/csv`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lists each problem of a refused file by row and column in words', async () => {
    vi.stubGlobal(
      'fetch',
      answer(422, {
        problems: [
          { row: 4, column: 'es', code: 'copy_too_long' },
          { row: null, column: 'step', code: 'missing_column' },
        ],
      }),
    );
    render(<CsvPanel templateId={THEME_IDS.template} canWrite />);

    upload();

    await waitFor(() => {
      expect(
        screen.getByText('Row 4, column es: The text is longer than this text allows.'),
      ).toBeVisible();
    });
    expect(screen.getByText(/^Header, column step: A required column is missing/)).toBeVisible();
  });

  it('says a status in words, and offers only the download to a reader', async () => {
    vi.stubGlobal('fetch', answer(413, {}));
    const { unmount } = render(<CsvPanel templateId={THEME_IDS.template} canWrite />);
    upload();
    await waitFor(() => {
      expect(screen.getByText('The file is larger than 2 MiB.')).toBeVisible();
    });
    unmount();

    render(<CsvPanel templateId={THEME_IDS.template} canWrite={false} />);
    expect(screen.queryByRole('form', { name: 'Import CSV' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download translations.csv' })).toBeVisible();
  });
});
