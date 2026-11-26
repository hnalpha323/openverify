/**
 * The console navigation (C23): every route, each gated by the permission that reads it. Stage 2
 * pages only add their route under `src/app/`; this list already links them.
 *
 * Hiding an item is UX only: the API enforces every permission.
 */
import { EXPORT_PERMISSIONS, type Permission } from '@openverify/core';
import { CONSOLE_COPY } from '../lib/copy/console';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Without it the item is hidden, and the page renders the forbidden panel. */
  readonly permission: Permission;
  /**
   * Other permissions any one of which also shows the item: a page whose API route takes no
   * static scope but serves what the caller holds one of (`GET /exports`, C166.2).
   */
  readonly anyOf?: readonly Permission[];
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const ACCOUNT_SECURITY_PATH = '/account/security';

/** C169.7 (Workflow 9C): the operator's own notification preferences (a session, no permission). */
export const NOTIFICATION_PREFERENCES_PATH = '/notifications';

const [FIRST_EXPORT_PERMISSION = 'inquiries:export', ...OTHER_EXPORT_PERMISSIONS] =
  Object.values(EXPORT_PERMISSIONS);

export const NAV_GROUPS: readonly NavGroup[] = Object.freeze([
  {
    label: 'Verifications',
    items: [
      { href: '/inquiries', label: 'Inquiries', permission: 'inquiries:read' },
      { href: '/accounts', label: 'Accounts', permission: 'accounts:read' },
      { href: '/account-types', label: 'Account types', permission: 'accounts:read' },
      { href: '/templates', label: 'Templates', permission: 'inquiry-templates:read' },
      // C160 (Workflow 9C): `GET /theme-sets` (theme-sets:read).
      { href: '/theme-sets', label: CONSOLE_COPY.nav.themeSets, permission: 'theme-sets:read' },
    ],
  },
  {
    // C164.9, C166 (Workflow 9C): `GET /analytics/*` (analytics:read); `GET /exports` takes no
    // static scope and lists the exports of the types the caller still holds `:export` for, so
    // the item shows to a holder of any one of them (EXPORT_PERMISSIONS).
    label: CONSOLE_COPY.nav.insights,
    items: [
      { href: '/analytics', label: CONSOLE_COPY.nav.analytics, permission: 'analytics:read' },
      {
        href: '/exports',
        label: CONSOLE_COPY.nav.exports,
        permission: FIRST_EXPORT_PERMISSION,
        anyOf: OTHER_EXPORT_PERMISSIONS,
      },
    ],
  },
  {
    // C86: each item is read with the scope of the API route behind it (C72.2, C72.3):
    // `GET /dashboard/reports`, `GET /report-templates`, `GET /dashboard/watchlist-sources`.
    // Report templates and Watchlist sources are `dashboard-report-config`'s pages.
    label: 'Reports',
    items: [
      { href: '/reports', label: 'Reports', permission: 'reports:read' },
      { href: '/report-templates', label: 'Report templates', permission: 'report-templates:read' },
      { href: '/watchlist-sources', label: 'Watchlist sources', permission: 'watchlists:read' },
      // C166.5 (Workflow 9C): `POST /reports/bulk` (reports:write).
      {
        href: '/exports/bulk-reports',
        label: CONSOLE_COPY.nav.bulkReports,
        permission: 'reports:write',
      },
    ],
  },
  {
    // C108: each item is read with the scope of the API route behind it: `GET /lists`
    // (lists:read), `GET /graph-queries` and `GET /graph-query-templates` (graph:read, which
    // viewers never hold), `GET /transactions` and `GET /transaction-types` (transactions:read;
    // editing a type needs transaction-types:write). Lists and Transactions are
    // `dashboard-lists-transactions`' pages, Graph is `dashboard-graph`'s.
    label: 'Risk',
    items: [
      { href: '/lists', label: 'Lists', permission: 'lists:read' },
      { href: '/graph', label: 'Graph', permission: 'graph:read' },
      { href: '/transactions', label: 'Transactions', permission: 'transactions:read' },
      { href: '/transaction-types', label: 'Transaction types', permission: 'transactions:read' },
    ],
  },
  {
    // C142.1 (Workflow 8C): each item is read with the scope of the API route behind it:
    // `GET /cases` (cases:read), `GET /case-templates` (case-templates:read), `GET /case-queues`
    // and `GET /case-assignment-policies`, and the settings page's `GET /case-sla-policies` and
    // `GET /case-calendars` (case-queues:read). `dashboard-cases`' pages.
    label: 'Cases',
    items: [
      { href: '/cases', label: 'Cases', permission: 'cases:read' },
      { href: '/case-templates', label: 'Case templates', permission: 'case-templates:read' },
      { href: '/case-queues', label: 'Queues', permission: 'case-queues:read' },
      { href: '/case-settings', label: 'Case settings', permission: 'case-queues:read' },
    ],
  },
  {
    // C141 (Workflow 8C): `GET /workflows` (workflows:read) and `GET /workflow-secrets`
    // (secrets:read, in `NOT_FOR_VIEWERS`, C112.5).
    label: 'Automation',
    items: [
      { href: '/workflows', label: 'Workflows', permission: 'workflows:read' },
      { href: '/secrets', label: 'Secrets', permission: 'secrets:read' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { href: '/webhooks', label: 'Webhooks', permission: 'webhooks:read' },
      { href: '/api-keys', label: 'API keys', permission: 'api-keys:read' },
      { href: '/api-logs', label: 'API logs', permission: 'api-logs:read' },
      { href: '/events', label: 'Events', permission: 'events:read' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { href: '/users', label: 'Users', permission: 'users:read' },
      { href: '/roles', label: 'Roles', permission: 'roles:read' },
      { href: '/audit-logs', label: 'Audit logs', permission: 'audit-logs:read' },
      { href: '/settings', label: 'Settings', permission: 'settings:read' },
      // C62.10, C66: the read-only trust store page of `dashboard-documents`, which reads
      // `GET /dashboard/trust-anchors` (`settings:read`).
      { href: '/trust-anchors', label: 'Chip trust store', permission: 'settings:read' },
      // C92, C108: the read-only network sources page, which reads
      // `GET /dashboard/network-sources` (`settings:read`).
      { href: '/network-sources', label: 'Network sources', permission: 'settings:read' },
    ],
  },
] satisfies NavGroup[]);

/** The groups and items `permissions` allow; empty groups are left out. */
export function visibleNavGroups(permissions: ReadonlySet<Permission>): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter(
      (item) =>
        permissions.has(item.permission) ||
        (item.anyOf ?? []).some((permission) => permissions.has(permission)),
    ),
  })).filter((group) => group.items.length > 0);
}

/** Where the console opens: the first page `permissions` allow, else the security page. */
export function homePath(permissions: ReadonlySet<Permission>): string {
  return visibleNavGroups(permissions)[0]?.items[0]?.href ?? ACCOUNT_SECURITY_PATH;
}

/** Whether `pathname` is the page `href` or one under it. */
export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The href of the one item `pathname` is most specifically under (the longest), or `null`: the bulk
 * report page sits under `/exports`, and only its own item is the current page.
 */
export function currentNavHref(pathname: string, groups: readonly NavGroup[]): string | null {
  let current: string | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    if (isCurrentPath(pathname, item.href) && item.href.length > (current?.length ?? -1)) {
      current = item.href;
    }
  }
  return current;
}
