import { PERMISSIONS } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PermissionChecklist } from './permission-checklist';
import { PermissionList } from './permission-list';

describe('PermissionChecklist', () => {
  it('offers every permission as a checkbox, grouped by area', () => {
    render(<PermissionChecklist checked={['inquiries:read']} held={PERMISSIONS} />);

    const all = screen.getByRole('group', { name: 'Permissions' });
    expect(within(all).getAllByRole('checkbox')).toHaveLength(PERMISSIONS.length);
    const inquiries = screen.getByRole('group', { name: 'Inquiries' });
    // read, write, redact and (Workflow 9B, C166.2) export.
    expect(within(inquiries).getAllByRole('checkbox')).toHaveLength(4);
    const read = within(inquiries).getByRole('checkbox', { name: 'View inquiries' });
    expect(read).toBeChecked();
    expect(read).toHaveAttribute('name', 'permissions');
    expect(read).toHaveAttribute('value', 'inquiries:read');
    expect(read).toHaveAccessibleDescription('inquiries:read');
    expect(within(inquiries).getByRole('checkbox', { name: 'Redact inquiries' })).not.toBeChecked();
  });

  it('offers only the permissions the operator holds, and says why the others are off (C12)', () => {
    render(<PermissionChecklist checked={[]} held={['inquiries:read', 'roles:write']} />);

    expect(screen.getByRole('checkbox', { name: 'View inquiries' })).toBeEnabled();
    const piiView = screen.getByRole('checkbox', { name: 'View personal data and files' });
    expect(piiView).toBeDisabled();
    expect(piiView).toHaveAccessibleDescription(
      'pii:view. You do not hold it, so you cannot grant it. Sensitive.',
    );
  });

  it('shows a validation message for the whole checklist', () => {
    render(
      <PermissionChecklist
        checked={[]}
        held={PERMISSIONS}
        error="Choose at least one permission."
      />,
    );

    expect(screen.getByRole('group', { name: 'Permissions' })).toHaveAccessibleDescription(
      'Choose at least one permission.',
    );
  });
});

describe('PermissionList', () => {
  it("lists a role's permissions by area, read-only", () => {
    render(<PermissionList permissions={['pii:view', 'inquiries:read', 'inquiries:write']} />);

    const inquiries = screen.getByRole('list', { name: 'Inquiries' });
    expect(
      within(inquiries)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['View inquiriesinquiries:read', 'Create and change inquiriesinquiries:write']);
    expect(screen.getByRole('list', { name: 'Personal data' })).toHaveTextContent(
      'View personal data and files',
    );
    expect(screen.queryByRole('list', { name: 'Webhooks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('says when a role grants nothing', () => {
    render(<PermissionList permissions={[]} />);

    expect(screen.getByText('This role grants no permissions.')).toBeVisible();
  });
});

describe('PermissionChecklist: the role editor of Workflow 9C (C167.4)', () => {
  it('disables a permission the API would refuse, with the reason per environment', () => {
    render(
      <PermissionChecklist
        checked={[]}
        held={PERMISSIONS}
        refusals={{ 'pii:view': 'You do not hold it in Production, so you cannot grant it.' }}
      />,
    );

    const pii = screen.getByRole('checkbox', { name: /^View personal data/u });
    expect(pii).toBeDisabled();
    expect(pii).toHaveAccessibleDescription(
      expect.stringContaining('You do not hold it in Production, so you cannot grant it.'),
    );
    expect(screen.getByRole('checkbox', { name: 'View inquiries' })).toBeEnabled();
  });

  it('marks sensitive permissions in words, and organisation-level ones as organisation-wide only', () => {
    render(<PermissionChecklist checked={[]} held={PERMISSIONS} />);

    expect(
      screen.getByRole('checkbox', { name: /^View personal data/u }),
    ).toHaveAccessibleDescription(expect.stringContaining('Sensitive'));
    expect(
      screen.getByRole('checkbox', { name: 'View inquiries' }),
    ).not.toHaveAccessibleDescription(expect.stringContaining('Sensitive'));
    expect(
      screen.getByRole('checkbox', { name: /^Invite and manage users/u }),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        'Organisation level: takes effect only in an organisation-wide assignment.',
      ),
    );
  });
});
