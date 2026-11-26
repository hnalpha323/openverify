import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoleChecklist } from './role-checklist';
import type { RoleOption } from './role-options';
import { ROLE_IDS } from './test-fixtures';

const OPTIONS: RoleOption[] = [
  { id: ROLE_IDS.admin, name: 'Admin', builtin: true, grantable: false },
  { id: ROLE_IDS.reviewer, name: 'Reviewer', builtin: true, grantable: true },
  { id: ROLE_IDS.support, name: 'Support', builtin: false, grantable: true },
];

describe('RoleChecklist', () => {
  it('offers each role as a labelled checkbox in a named group', () => {
    render(<RoleChecklist options={OPTIONS} defaultChecked={[ROLE_IDS.support]} />);

    const group = screen.getByRole('group', { name: 'Roles' });
    expect(group).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Reviewer' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Support' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Support' })).toHaveAttribute('name', 'role-ids');
    expect(screen.getByRole('checkbox', { name: 'Support' })).toHaveAttribute(
      'value',
      ROLE_IDS.support,
    );
    expect(screen.getByRole('checkbox', { name: 'Reviewer' })).toHaveAccessibleDescription(
      'Built-in role',
    );
    expect(screen.getByRole('checkbox', { name: 'Support' })).toHaveAccessibleDescription(
      'Custom role',
    );
  });

  it('offers only the roles the operator may grant, and says why the others are off', () => {
    render(<RoleChecklist options={OPTIONS} defaultChecked={[]} />);

    const admin = screen.getByRole('checkbox', { name: 'Admin' });
    expect(admin).toBeDisabled();
    expect(admin).toHaveAccessibleDescription(
      'Built-in role. You cannot grant it: it includes permissions you do not hold.',
    );
    expect(screen.getByRole('checkbox', { name: 'Reviewer' })).toBeEnabled();
  });

  it('shows a validation message for the group', () => {
    render(
      <RoleChecklist options={OPTIONS} defaultChecked={[]} error="Choose at least one role." />,
    );

    const group = screen.getByRole('group', { name: 'Roles' });
    expect(group).toHaveAccessibleDescription('Choose at least one role.');
  });
});
