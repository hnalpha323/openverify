/**
 * The C15 permissions in plain words, grouped by area for the role checklist. Both maps are
 * keyed by `Permission`, so a permission added to `@openverify/core` fails the typecheck until
 * it has a label and an area here.
 */
import { PERMISSIONS, type Permission } from '@openverify/core';

const AREAS = [
  { id: 'inquiries', label: 'Inquiries' },
  { id: 'inquiry-sessions', label: 'Inquiry sessions' },
  { id: 'verifications', label: 'Verifications' },
  { id: 'accounts', label: 'Accounts' },
  // C72.2 (Phase 6): reports, report templates and the watchlist sources.
  { id: 'reports', label: 'Reports' },
  // Phase 7 (Workflow 7B): lists and importers, the account graph, transactions.
  { id: 'lists', label: 'Lists' },
  { id: 'graph', label: 'Graph' },
  { id: 'transactions', label: 'Transactions' },
  // Phase 8 (Workflow 8B): cases, their templates and queues.
  { id: 'cases', label: 'Cases' },
  // Phase 9 (Workflow 9B): the analytics of every object above, as counts and rates.
  { id: 'analytics', label: 'Analytics' },
  // Phase 11 (Workflow 11A): sharing with other organisations of this install.
  { id: 'connect', label: 'Connect' },
  // Phase 8 (Workflow 8A): workflows and their runs, and the secrets their steps use.
  { id: 'workflows', label: 'Workflows' },
  { id: 'templates', label: 'Templates' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'events', label: 'Events' },
  { id: 'api-keys', label: 'API keys' },
  { id: 'api-logs', label: 'API logs' },
  { id: 'secrets', label: 'Workflow secrets' },
  { id: 'pii', label: 'Personal data' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'audit-logs', label: 'Audit logs' },
  { id: 'settings', label: 'Settings' },
  { id: 'environments', label: 'Environments' },
] as const;

export type PermissionAreaId = (typeof AREAS)[number]['id'];

const PERMISSION_INFO: Readonly<Record<Permission, { area: PermissionAreaId; label: string }>> = {
  'inquiries:read': { area: 'inquiries', label: 'View inquiries' },
  'inquiries:write': { area: 'inquiries', label: 'Create and change inquiries' },
  'inquiries:redact': { area: 'inquiries', label: 'Redact inquiries' },
  'inquiry-sessions:read': { area: 'inquiry-sessions', label: 'View inquiry sessions' },
  'inquiry-sessions:write': { area: 'inquiry-sessions', label: 'Expire inquiry sessions' },
  'verifications:read': { area: 'verifications', label: 'View verifications and checks' },
  'accounts:read': { area: 'accounts', label: 'View accounts' },
  'accounts:write': { area: 'accounts', label: 'Create and change accounts' },
  'accounts:redact': { area: 'accounts', label: 'Redact accounts' },
  'lists:read': { area: 'lists', label: 'View lists and list matches' },
  'lists:write': { area: 'lists', label: 'Change lists, add items and dismiss matches' },
  'importers:read': { area: 'lists', label: 'View list imports' },
  'importers:write': { area: 'lists', label: 'Import list items' },
  'graph:read': { area: 'graph', label: 'View graph queries and their results' },
  'graph:write': { area: 'graph', label: 'Run graph queries and edit their templates' },
  'transactions:read': { area: 'transactions', label: 'View transactions' },
  'transactions:write': { area: 'transactions', label: 'Create and change transactions' },
  'transactions:redact': { area: 'transactions', label: 'Redact transactions' },
  'transaction-types:write': { area: 'transactions', label: 'Edit transaction types' },
  'inquiry-templates:read': { area: 'templates', label: 'View templates' },
  'inquiry-templates:write': { area: 'templates', label: 'Create and edit templates' },
  'inquiry-templates:publish': { area: 'templates', label: 'Publish template versions' },
  'webhooks:read': { area: 'webhooks', label: 'View webhooks and deliveries' },
  'webhooks:write': { area: 'webhooks', label: 'Manage webhooks' },
  'events:read': { area: 'events', label: 'View events' },
  'api-keys:read': { area: 'api-keys', label: 'View API keys' },
  'api-keys:write': { area: 'api-keys', label: 'Manage API keys' },
  'api-logs:read': { area: 'api-logs', label: 'View API logs' },
  'pii:view': { area: 'pii', label: 'View personal data and files' },
  'users:read': { area: 'users', label: 'View users' },
  'users:write': { area: 'users', label: 'Invite and manage users' },
  'roles:read': { area: 'roles', label: 'View roles' },
  'roles:write': { area: 'roles', label: 'Manage custom roles' },
  'audit-logs:read': { area: 'audit-logs', label: 'View audit logs' },
  'settings:read': { area: 'settings', label: 'View settings' },
  'settings:write': { area: 'settings', label: 'Change settings' },
  // C90.8, C107.7 (Phase 7): the collection tiers, the biometric-list basis and graph indexing.
  'settings:privacy': { area: 'settings', label: 'Change privacy and collection settings' },
  'environments:production': { area: 'environments', label: 'Use production' },
  // C55.11: the sandbox SMS sink, which holds one-time codes, so viewers never get it.
  'sandbox:read': { area: 'environments', label: 'Read the sandbox SMS messages' },
  // C72.2 (Phase 6): viewers read reports with personal data masked.
  'reports:read': { area: 'reports', label: 'View reports' },
  'reports:write': { area: 'reports', label: 'Create, tag and run reports and pause monitoring' },
  'reports:review': { area: 'reports', label: 'Review and dismiss report matches' },
  'reports:redact': { area: 'reports', label: 'Redact reports' },
  'report-templates:read': { area: 'reports', label: 'View report templates' },
  'report-templates:write': { area: 'reports', label: 'Create and edit report templates' },
  'report-templates:publish': { area: 'reports', label: 'Publish report template versions' },
  'watchlists:read': { area: 'reports', label: 'View the watchlist sources' },
  // C112.5 (Phase 8, Workflow 8A): viewers read definitions, never a run's values or a secret.
  'workflows:read': { area: 'workflows', label: 'View workflows and their versions' },
  'workflows:write': { area: 'workflows', label: 'Create and edit workflows' },
  'workflows:publish': { area: 'workflows', label: 'Publish, roll out and promote workflows' },
  'workflows:trigger': { area: 'workflows', label: 'Start workflows and run their actions' },
  'workflow-runs:read': { area: 'workflows', label: 'View workflow runs' },
  'workflow-runs:write': { area: 'workflows', label: 'Resume, rerun and cancel workflow runs' },
  'workflow-runs:redact': { area: 'workflows', label: 'Redact workflow runs' },
  'secrets:read': { area: 'secrets', label: 'View workflow secret keys and metadata' },
  'secrets:write': { area: 'secrets', label: 'Set and rotate workflow secrets' },
  // C127.9: a mark workflow conditions read; no check reads it.
  'devices:write': { area: 'inquiry-sessions', label: 'Trust and untrust devices' },
  // C129.4 (Phase 8, Workflow 8B): `cases:export` is no read, so a viewer never holds it.
  'cases:read': { area: 'cases', label: 'View cases' },
  'cases:write': { area: 'cases', label: 'Create, work and resolve cases' },
  'cases:assign': { area: 'cases', label: 'Assign cases to other people' },
  'cases:redact': { area: 'cases', label: 'Redact cases and any comment' },
  'cases:export': { area: 'cases', label: 'Export cases' },
  'case-templates:read': { area: 'cases', label: 'View case templates' },
  'case-templates:write': { area: 'cases', label: 'Create and edit case templates' },
  'case-templates:publish': { area: 'cases', label: 'Publish case template versions' },
  'case-queues:read': { area: 'cases', label: 'View queues, policies and calendars' },
  'case-queues:write': { area: 'cases', label: 'Manage queues, policies and calendars' },
  // C167.1 (Phase 9, Workflow 9A): theme sets style template flows; deployments are the history of
  // template publishes. Both sit with the templates.
  'theme-sets:read': { area: 'templates', label: 'View theme sets' },
  'theme-sets:write': { area: 'templates', label: 'Create, edit and archive theme sets' },
  'deployments:read': { area: 'templates', label: 'View the deployment history of templates' },
  // C167.1, C166.2 (Phase 9, Workflow 9B): analytics has an area of its own; each export sits with
  // what it exports. No export is a read, so a viewer never holds one.
  'analytics:read': { area: 'analytics', label: 'View analytics' },
  'inquiries:export': { area: 'inquiries', label: 'Export inquiries' },
  'verifications:export': { area: 'verifications', label: 'Export verifications' },
  'accounts:export': { area: 'accounts', label: 'Export accounts' },
  'reports:export': { area: 'reports', label: 'Export reports' },
  'lists:export': { area: 'lists', label: 'Export lists and their items' },
  'transactions:export': { area: 'transactions', label: 'Export transactions' },
  // C240.1 (Phase 11, Workflow 11A): Connect. Creating and changing a connection, and activating
  // one, take effect only through a role held in every environment (C231.9).
  'connect-connections:read': {
    area: 'connect',
    label: 'View connections and their share policies',
  },
  'connect-connections:write': {
    area: 'connect',
    label: 'Create, deactivate and reactivate connections, and change a share policy',
  },
  'connect-share-tokens:read': { area: 'connect', label: 'View share tokens and consent records' },
  'connect-share-tokens:write': {
    area: 'connect',
    label: 'Create and expire share tokens, and withdraw a consent',
  },
  'connect-share-tokens:redeem': { area: 'connect', label: 'Redeem share tokens from a partner' },
  'connect-share-tokens:peek': {
    area: 'connect',
    label: 'Peek at what a share token would copy, before redeeming it',
  },
  'connect-consent-records:attest': {
    area: 'connect',
    label: 'Attest a consent the platform did not witness',
  },
  'connect-connections:activate': {
    area: 'connect',
    label: 'Accept a partner’s share policy and activate a connection',
  },
  // C253.1 (Phase 11, Workflow 11B): the per-account access export, beside the accounts.
  'account-access:export': {
    area: 'accounts',
    label: 'Export everything held about one account, for an access request',
  },
};

export interface PermissionArea {
  readonly id: PermissionAreaId;
  readonly label: string;
  readonly permissions: readonly Permission[];
}

/** What `permission` allows, in plain words. */
export function permissionLabel(permission: Permission): string {
  return PERMISSION_INFO[permission].label;
}

/**
 * `permissions` (every permission by default) grouped by area, areas in a fixed order and each
 * area's permissions in core's order. Areas without any are left out.
 */
export function permissionAreas(
  permissions: readonly Permission[] = PERMISSIONS,
): PermissionArea[] {
  const included = new Set(permissions);
  return AREAS.map((area) => ({
    id: area.id,
    label: area.label,
    permissions: PERMISSIONS.filter(
      (permission) => included.has(permission) && PERMISSION_INFO[permission].area === area.id,
    ),
  })).filter((area) => area.permissions.length > 0);
}
