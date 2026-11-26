import { PERMISSIONS } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Nav } from './nav';
import { visibleNavGroups } from './nav-items';

const navigation = vi.hoisted(() => ({ pathname: '/inquiries' }));

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

beforeEach(() => {
  navigation.pathname = '/inquiries';
});

describe('Nav', () => {
  it('is the console navigation, with a labelled list per group', () => {
    render(<Nav groups={visibleNavGroups(new Set(PERMISSIONS))} />);

    const nav = screen.getByRole('navigation', { name: 'Console' });
    expect(within(nav).getByRole('list', { name: 'Integrations' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'API keys' })).toHaveAttribute(
      'href',
      '/api-keys',
    );
    expect(within(nav).getAllByRole('link')).toHaveLength(31);
    expect(within(nav).getByRole('list', { name: 'Risk' })).toBeVisible();
    expect(within(nav).getByRole('list', { name: 'Cases' })).toBeVisible();
    expect(within(nav).getByRole('list', { name: 'Automation' })).toBeVisible();
    expect(within(nav).getByRole('list', { name: 'Reports' })).toBeVisible();
  });

  it('marks the section of the current page', () => {
    navigation.pathname = '/webhooks/wbh_1';
    render(<Nav groups={visibleNavGroups(new Set(PERMISSIONS))} />);

    expect(screen.getByRole('link', { name: 'Webhooks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inquiries' })).not.toHaveAttribute('aria-current');
  });

  it('marks only the most specific item when two items hold the current page', () => {
    navigation.pathname = '/exports/bulk-reports';
    render(<Nav groups={visibleNavGroups(new Set(PERMISSIONS))} />);

    expect(screen.getByRole('link', { name: 'Bulk reports' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Exports' })).not.toHaveAttribute('aria-current');
  });
});
