import type { Permission, SavedViewList } from '@openverify/core';

/** C165.1: the permission that reads each list a view can name, as the API checks it. */
export const SAVED_VIEW_READ_PERMISSIONS: Readonly<Record<SavedViewList, Permission>> =
  Object.freeze({
    inquiries: 'inquiries:read',
    accounts: 'accounts:read',
    reports: 'reports:read',
    cases: 'cases:read',
    transactions: 'transactions:read',
    'api-logs': 'api-logs:read',
    'webhook-deliveries': 'webhooks:read',
    events: 'events:read',
    'audit-logs': 'audit-logs:read',
  });
