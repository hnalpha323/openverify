import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BULK_UPLOAD_PATH, BulkReportForm } from './bulk-report-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

const TEMPLATES = [{ id: 'rptp_01JF0000000000000000000012', name: 'Watchlist screening' }];

async function send(status: number, body: unknown) {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal('fetch', fetch);
  render(<BulkReportForm templates={TEMPLATES} />);
  await user.upload(
    screen.getByLabelText('CSV file'),
    new File(['name-first\nsynthetic'], 'people.csv', { type: 'text/csv' }),
  );
  await user.click(screen.getByRole('button', { name: 'Upload and create the reports' }));
  return fetch;
}

describe('the bulk report form (C166.5)', () => {
  it('posts the template and the file to the streaming route, then shows the job', async () => {
    const fetch = await send(202, {
      message: 'The file was accepted: its reports are being created.',
      'job-id': 'rbulk_01JF0000000000000000000011',
    });

    const [path, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(BULK_UPLOAD_PATH);
    expect((init.body as FormData).get('report-template-id')).toBe(TEMPLATES[0]?.id);
    expect(await screen.findByRole('status')).toHaveTextContent('The file was accepted');
    expect(push).toHaveBeenCalledWith('/exports/bulk-reports?job=rbulk_01JF0000000000000000000011');
  });

  it('says a refusal in the route’s words and stays on the form', async () => {
    await send(413, { message: 'The file is larger than 2 MiB.' });

    expect(await screen.findByText('The file is larger than 2 MiB.')).toBeVisible();
    expect(push).not.toHaveBeenCalled();
  });

  it('says there is nothing to upload to without an active template', () => {
    render(<BulkReportForm templates={[]} />);

    expect(screen.getByText(/No active report template/)).toBeVisible();
  });
});
