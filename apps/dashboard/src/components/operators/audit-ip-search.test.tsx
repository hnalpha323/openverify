import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { auditLog } from './test-fixtures';
import { AuditIpSearch } from './audit-ip-search';

describe('AuditIpSearch (C168.6)', () => {
  it('posts the address and lists the entries found, saying how many, without changing the URL', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { entries: [auditLog()], more: true } }),
    );
    const before = window.location.href;
    render(<AuditIpSearch action={action} />);

    const search = screen.getByRole('search', { name: 'Find entries from one IP address' });
    await userEvent.type(
      within(search).getByRole('textbox', { name: 'IP address' }),
      '203.0.113.9',
    );
    await userEvent.click(within(search).getByRole('button', { name: 'Find entries' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The newest 25 entries from this address are shown; more exist. Narrow the search with the filters above.',
    );
    expect(
      screen.getByRole('table', { name: 'Audit log entries from this address' }),
    ).toBeVisible();
    expect(window.location.href).toBe(before);
  });

  it('says when no entry came from the address', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { entries: [], more: false } }),
    );
    render(<AuditIpSearch action={action} />);

    await userEvent.type(screen.getByRole('textbox', { name: 'IP address' }), '203.0.113.9');
    await userEvent.click(screen.getByRole('button', { name: 'Find entries' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No audit entry came from this address.',
    );
  });

  it('shows a refusal at the field', async () => {
    const action = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        problem: {
          title: 'Check the address',
          errors: [
            { pointer: '/ip', detail: 'Enter one IPv4 or IPv6 address, such as 203.0.113.9.' },
          ],
        },
      }),
    );
    render(<AuditIpSearch action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Find entries' }));

    expect(await screen.findByRole('textbox', { name: 'IP address' })).toHaveAccessibleDescription(
      expect.stringContaining('Enter one IPv4 or IPv6 address'),
    );
  });
});
