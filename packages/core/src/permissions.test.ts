import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  BUILTIN_ROLES,
  BUILTIN_ROLE_KEYS,
  OPERATOR_PERMISSIONS,
  PERMISSIONS,
  apiScopeSchema,
  isApiScope,
  isPermission,
  missingPermissions,
  permissionSchema,
  permissionsForRoles,
  type Permission,
} from './permissions.js';

const PHASE1_SCOPES = [
  'inquiries:read',
  'inquiries:write',
  'inquiry-templates:read',
  'inquiry-templates:write',
  'verifications:read',
  'webhooks:read',
  'webhooks:write',
  'events:read',
];

const PHASE2_SCOPES = [
  'accounts:read',
  'accounts:write',
  'accounts:redact',
  'inquiries:redact',
  'inquiry-sessions:read',
  'inquiry-sessions:write',
  'inquiry-templates:publish',
  'api-keys:read',
  'api-keys:write',
  'api-logs:read',
  'audit-logs:read',
];

/** C55.11 (Phase 5, decision 13): the sandbox SMS sink. */
const PHASE5_SCOPES = ['sandbox:read'];

/** C72.2 (Phase 6): reports, report templates and the watchlist sources page. */
const PHASE6_SCOPES = [
  'reports:read',
  'reports:write',
  'reports:review',
  'reports:redact',
  'report-templates:read',
  'report-templates:write',
  'report-templates:publish',
  'watchlists:read',
];

/** C97.3, C100, C102.1, C104.1, C105.6 (Phase 7, Workflow 7B): lists, importers, graph, transactions. */
const PHASE7_SCOPES = [
  'lists:read',
  'lists:write',
  'importers:read',
  'importers:write',
  'graph:read',
  'graph:write',
  'transactions:read',
  'transactions:write',
  'transactions:redact',
  'transaction-types:write',
];

/** C112.5, C143.9 (Phase 8, Workflow 8A): workflows, runs, secrets, and Trust Device's scope. */
const PHASE8_WORKFLOW_SCOPES = [
  'workflows:read',
  'workflows:write',
  'workflows:publish',
  'workflows:trigger',
  'workflow-runs:read',
  'workflow-runs:write',
  'workflow-runs:redact',
  'secrets:read',
  'secrets:write',
];
const PHASE8_SCOPES = [...PHASE8_WORKFLOW_SCOPES, 'devices:write'];

/** C129.4 (Phase 8, Workflow 8B): cases, their templates, and queues with what routes to them. */
const PHASE8_CASE_SCOPES = [
  'cases:read',
  'cases:write',
  'cases:assign',
  'cases:redact',
  'cases:export',
  'case-templates:read',
  'case-templates:write',
  'case-templates:publish',
  'case-queues:read',
  'case-queues:write',
];

/**
 * C167.1 (Phase 9, Workflow 9A Stage 1a): theme sets (decision 29: their own permission, so a
 * reviewer cannot restyle a consent screen) and the read-only deployment history.
 */
const PHASE9A_SCOPES = ['theme-sets:read', 'theme-sets:write', 'deployments:read'];

/**
 * C167.1 (Phase 9, Workflow 9B Stage 1a): the analytics read and an export permission per object
 * type (C166.2). None of the six is a `:read`, so a viewer never holds one, and each is admin's by
 * default (Phase 8 decision 68's rule for `cases:export`).
 */
const PHASE9B_EXPORT_SCOPES = [
  'inquiries:export',
  'verifications:export',
  'accounts:export',
  'reports:export',
  'lists:export',
  'transactions:export',
];
const PHASE9B_SCOPES = ['analytics:read', ...PHASE9B_EXPORT_SCOPES];

/**
 * C240.1 (Phase 11, Workflow 11A Stage 1a): Connect's seven scopes. Only the two reads are held
 * outside admin; attesting a consent is its own scope, never implied by a write (review P03).
 */
const PHASE11A_CONNECT_READS = ['connect-connections:read', 'connect-share-tokens:read'];
const PHASE11A_CONNECT_ADMIN_SCOPES = [
  'connect-connections:write',
  'connect-share-tokens:write',
  'connect-share-tokens:redeem',
  'connect-share-tokens:peek',
  'connect-consent-records:attest',
];
const PHASE11A_SCOPES = [
  'connect-connections:read',
  'connect-connections:write',
  'connect-share-tokens:read',
  'connect-share-tokens:write',
  'connect-share-tokens:redeem',
  'connect-share-tokens:peek',
  'connect-consent-records:attest',
];

/** C253.1 (Phase 11, Workflow 11B Stage 1a): the access export, admin's alone. */
const PHASE11B_SCOPES = ['account-access:export'];

const sorted = (values: Iterable<string>) => [...values].sort();

describe('API_SCOPES (C2, C12)', () => {
  it('keeps the Phase 1 scopes first, then adds the C12 scopes, and those of Phases 5, 6, 7 and 8', () => {
    expect(API_SCOPES).toEqual([
      ...PHASE1_SCOPES,
      ...PHASE2_SCOPES,
      ...PHASE5_SCOPES,
      ...PHASE6_SCOPES,
      ...PHASE7_SCOPES,
      ...PHASE8_SCOPES,
      ...PHASE8_CASE_SCOPES,
      ...PHASE9A_SCOPES,
      ...PHASE9B_SCOPES,
      ...PHASE11A_SCOPES,
      ...PHASE11B_SCOPES,
    ]);
    expect(Object.isFrozen(API_SCOPES)).toBe(true);
  });

  it('are <resource>:<action> pairs in kebab-case', () => {
    for (const scope of API_SCOPES) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(scope).toMatch(/^[a-z]+(?:-[a-z]+)*:[a-z]+$/);
    }
  });

  it('validates scopes', () => {
    expect(apiScopeSchema.parse('api-logs:read')).toBe('api-logs:read');
    expect(apiScopeSchema.safeParse('pii:view').success).toBe(false);
    expect(isApiScope('webhooks:write')).toBe(true);
    expect(isApiScope('users:read')).toBe(false);
    expect(isApiScope(42)).toBe(false);
  });
});

describe('PERMISSIONS (C15)', () => {
  it('is every API scope plus the operator permissions', () => {
    expect(OPERATOR_PERMISSIONS).toEqual([
      'pii:view',
      'users:read',
      'users:write',
      'roles:read',
      'roles:write',
      'settings:read',
      'settings:write',
      // C90.8, C107.7 (Phase 7, F37, P10): the legal switches (collection tiers, the
      // biometric-list basis, graph indexing).
      'settings:privacy',
      'environments:production',
      // C231.3, C240.1 (Workflow 11A): accepting a partner's share policy; a user session only.
      'connect-connections:activate',
    ]);
    expect(PERMISSIONS).toEqual([...API_SCOPES, ...OPERATOR_PERMISSIONS]);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
  });

  it('recognises permissions by value only', () => {
    expect(isPermission('pii:view')).toBe(true);
    expect(isPermission('inquiries:redact')).toBe(true);
    expect(isPermission('inquiries:delete')).toBe(false);
    expect(isPermission('toString')).toBe(false);
    expect(isPermission(undefined)).toBe(false);
    expect(permissionSchema.safeParse('environments:production').success).toBe(true);
    expect(permissionSchema.safeParse('environments:sandbox').success).toBe(false);
  });
});

describe('BUILTIN_ROLES (C15)', () => {
  it('has the four built-in roles with stable keys', () => {
    expect(BUILTIN_ROLE_KEYS).toEqual(['admin', 'developer', 'reviewer', 'viewer']);
    expect(Object.keys(BUILTIN_ROLES)).toEqual([...BUILTIN_ROLE_KEYS]);
    for (const key of BUILTIN_ROLE_KEYS) {
      expect(BUILTIN_ROLES[key]).toMatchObject({ key, name: expect.any(String) as unknown });
      expect(Object.isFrozen(BUILTIN_ROLES[key])).toBe(true);
      expect(Object.isFrozen(BUILTIN_ROLES[key].permissions)).toBe(true);
      const permissions = BUILTIN_ROLES[key].permissions;
      expect(new Set(permissions).size).toBe(permissions.length);
      expect(permissions.every((permission) => isPermission(permission))).toBe(true);
    }
    expect(Object.isFrozen(BUILTIN_ROLES)).toBe(true);
  });

  it('gives admin every permission', () => {
    expect(BUILTIN_ROLES.admin.permissions).toEqual(PERMISSIONS);
  });

  it('gives developer templates, webhooks, API keys, logs, events, inquiries, sessions, verifications read, accounts read and production', () => {
    expect(sorted(BUILTIN_ROLES.developer.permissions)).toEqual(
      sorted([
        'inquiry-templates:read',
        'inquiry-templates:write',
        'inquiry-templates:publish',
        'webhooks:read',
        'webhooks:write',
        'api-keys:read',
        'api-keys:write',
        'api-logs:read',
        'events:read',
        'inquiries:read',
        'inquiries:write',
        'inquiry-sessions:read',
        'inquiry-sessions:write',
        'accounts:read',
        'verifications:read',
        'environments:production',
        // C55.11: developers test OTP flows in sandbox against the SMS sink.
        'sandbox:read',
        // C72.2: every report scope but review and redaction.
        'reports:read',
        'reports:write',
        'report-templates:read',
        'report-templates:write',
        'report-templates:publish',
        'watchlists:read',
        ...PHASE7_SCOPES.filter((scope) => scope !== 'transactions:redact'),
        // C112.5: every workflow and secret scope but `workflow-runs:redact`; `devices:write`,
        // because a developer publishes the workflow that holds a Trust Device step.
        ...PHASE8_SCOPES.filter((scope) => scope !== 'workflow-runs:redact'),
        // C129.4 (decision 68): every case scope but `cases:export`.
        ...PHASE8_CASE_SCOPES.filter((scope) => scope !== 'cases:export'),
        // C167.1: the theme and deployment scopes.
        ...PHASE9A_SCOPES,
        // C167.1 (Workflow 9B): analytics, and no export.
        'analytics:read',
        // C240.1 (Workflow 11A): the two Connect reads.
        ...PHASE11A_CONNECT_READS,
      ]),
    );
  });

  it('gives reviewer inquiries, redaction, sessions read, verifications read, accounts, events read and pii:view', () => {
    expect(sorted(BUILTIN_ROLES.reviewer.permissions)).toEqual(
      sorted([
        'inquiries:read',
        'inquiries:write',
        'inquiries:redact',
        'inquiry-sessions:read',
        'verifications:read',
        'accounts:read',
        'accounts:write',
        'accounts:redact',
        'events:read',
        // C72.2: reviewers read, review, run and redact reports and read templates and sources.
        'reports:read',
        'reports:write',
        'reports:review',
        'reports:redact',
        'report-templates:read',
        'watchlists:read',
        ...PHASE7_SCOPES.filter(
          (scope) => scope !== 'importers:write' && scope !== 'transaction-types:write',
        ),
        // C112.5: reviewers run case and account actions under C121.3 and follow them.
        'workflows:read',
        'workflows:trigger',
        'workflow-runs:read',
        // C127.9: trusting a device is a reversible review outcome, audited.
        'devices:write',
        // C129.4 (decision 68): reviewers work and assign cases, and read how they are set up.
        'cases:read',
        'cases:write',
        'cases:assign',
        'case-templates:read',
        'case-queues:read',
        'pii:view',
        // C167.1 (Workflow 9B): reviewers read analytics; the per-reviewer view also needs
        // users:write (C164.5), which they do not hold.
        'analytics:read',
        // C240.1 (Workflow 11A): the two Connect reads.
        ...PHASE11A_CONNECT_READS,
      ]),
    );
  });

  it('gives every built-in role analytics:read, counts and rates with no personal data (C167.1)', () => {
    for (const key of BUILTIN_ROLE_KEYS) {
      expect(BUILTIN_ROLES[key].permissions).toContain('analytics:read');
    }
    const analytics = ['analytics:read'].filter(isPermission);
    expect(analytics).toEqual(['analytics:read']);
    // A role or key without it is refused: one holding only the inquiry reads.
    expect(missingPermissions(new Set<Permission>(['inquiries:read']), analytics)).toEqual([
      'analytics:read',
    ]);
  });

  it.each(PHASE9B_EXPORT_SCOPES)(
    'gives %s to admin alone, refused to developer, reviewer and viewer (C166.2, C167.1)',
    (scope) => {
      const requested = [scope].filter(isPermission);
      expect(requested).toEqual([scope]);
      const holders = BUILTIN_ROLE_KEYS.filter((key) =>
        (BUILTIN_ROLES[key].permissions as readonly string[]).includes(scope),
      );
      expect(holders).toEqual(['admin']);
      for (const key of ['developer', 'reviewer', 'viewer'] as const) {
        expect(missingPermissions(new Set(BUILTIN_ROLES[key].permissions), requested)).toEqual([
          scope,
        ]);
      }
    },
  );

  it('gives viewers the report reads with PII masked, and keeps review and redaction from developer and viewer (C72.2)', () => {
    for (const permission of ['reports:read', 'report-templates:read', 'watchlists:read']) {
      expect(BUILTIN_ROLES.viewer.permissions).toContain(permission);
    }
    for (const key of ['developer', 'viewer'] as const) {
      expect(BUILTIN_ROLES[key].permissions).not.toContain('reports:review');
      expect(BUILTIN_ROLES[key].permissions).not.toContain('reports:redact');
    }
    expect(BUILTIN_ROLES.reviewer.permissions).not.toContain('report-templates:write');
    expect(BUILTIN_ROLES.reviewer.permissions).not.toContain('report-templates:publish');
  });

  it('lets developer and reviewer read the verifications behind a decision, as viewer can (2B K001)', () => {
    for (const key of ['developer', 'reviewer', 'viewer'] as const) {
      expect(BUILTIN_ROLES[key].permissions).toContain('verifications:read');
    }
  });

  it('gives viewer every :read permission except API and audit logs, the sandbox SMS sink, the graph, run values and secrets, and never pii:view', () => {
    const excluded: readonly string[] = [
      'api-logs:read',
      'audit-logs:read',
      'sandbox:read',
      'graph:read',
      'workflow-runs:read',
      'secrets:read',
    ];
    const expected = PERMISSIONS.filter(
      (permission) => permission.endsWith(':read') && !excluded.includes(permission),
    );
    expect(BUILTIN_ROLES.viewer.permissions).toEqual(expected);
    expect(BUILTIN_ROLES.viewer.permissions).toContain('users:read');
    expect(BUILTIN_ROLES.viewer.permissions).not.toContain('pii:view');
  });

  it('keeps the sandbox SMS sink, which serves one-time codes, away from viewer and reviewer (C55.11)', () => {
    expect(BUILTIN_ROLES.viewer.permissions).not.toContain('sandbox:read');
    expect(BUILTIN_ROLES.reviewer.permissions).not.toContain('sandbox:read');
    expect(isApiScope('sandbox:read')).toBe(true);
  });

  it('keeps pii:view away from developer and viewer', () => {
    expect(BUILTIN_ROLES.developer.permissions).not.toContain('pii:view');
    expect(BUILTIN_ROLES.viewer.permissions).not.toContain('pii:view');
  });

  it('keeps run values and secret metadata from viewers, and lets them read definitions (C112.5, P11)', () => {
    const viewer: readonly string[] = BUILTIN_ROLES.viewer.permissions;
    expect(viewer).toContain('workflows:read');
    expect(viewer).not.toContain('workflow-runs:read');
    expect(viewer).not.toContain('secrets:read');
  });

  it('keeps run redaction to admin (C112.5, P35)', () => {
    const holders = BUILTIN_ROLE_KEYS.filter((key) =>
      (BUILTIN_ROLES[key].permissions as readonly string[]).includes('workflow-runs:redact'),
    );
    expect(holders).toEqual(['admin']);
  });

  it('keeps case exports to admin and case redaction to admin and developer (C129.4, decision 68)', () => {
    const holders = (permission: string) =>
      BUILTIN_ROLE_KEYS.filter((key) =>
        (BUILTIN_ROLES[key].permissions as readonly string[]).includes(permission),
      );
    expect(holders('cases:export')).toEqual(['admin']);
    expect(holders('cases:redact')).toEqual(['admin', 'developer']);
  });

  it('gives viewers the case reads with values masked, and nothing that writes (C129.4)', () => {
    const viewer: readonly string[] = BUILTIN_ROLES.viewer.permissions;
    for (const scope of ['cases:read', 'case-templates:read', 'case-queues:read']) {
      expect(viewer).toContain(scope);
    }
    for (const scope of PHASE8_CASE_SCOPES.filter((name) => !name.endsWith(':read'))) {
      expect(viewer).not.toContain(scope);
    }
  });

  it('lets admin and developer restyle a flow, and never a reviewer or a viewer (C167.1, decision 29)', () => {
    const holders = (permission: string) =>
      BUILTIN_ROLE_KEYS.filter((key) =>
        (BUILTIN_ROLES[key].permissions as readonly string[]).includes(permission),
      );
    const write = ['theme-sets:write'].filter(isPermission);
    expect(holders('theme-sets:write')).toEqual(['admin', 'developer']);
    expect(missingPermissions(new Set(BUILTIN_ROLES.reviewer.permissions), write)).toEqual([
      'theme-sets:write',
    ]);
    expect(missingPermissions(new Set(BUILTIN_ROLES.viewer.permissions), write)).toEqual([
      'theme-sets:write',
    ]);
  });

  it('gives viewers the theme and deployment reads, which hold no personal data (C167.1)', () => {
    const viewer: readonly string[] = BUILTIN_ROLES.viewer.permissions;
    const deployments = ['deployments:read'].filter(isPermission);
    expect(viewer).toContain('theme-sets:read');
    expect(viewer).toContain('deployments:read');
    expect(BUILTIN_ROLES.reviewer.permissions).not.toContain('deployments:read');
    expect(missingPermissions(new Set(BUILTIN_ROLES.reviewer.permissions), deployments)).toEqual([
      'deployments:read',
    ]);
  });

  it('gives settings:privacy to admin only (C90.8, C107.7)', () => {
    const held = (key: keyof typeof BUILTIN_ROLES) =>
      new Set<string>(BUILTIN_ROLES[key].permissions).has('settings:privacy');
    expect(held('admin')).toBe(true);
    expect([held('developer'), held('reviewer'), held('viewer')]).toEqual([false, false, false]);
  });
});

describe('permissionsForRoles', () => {
  it('is the union of the roles a user holds', () => {
    const permissions = permissionsForRoles([
      { permissions: ['inquiries:read', 'pii:view'] },
      { permissions: ['inquiries:read', 'roles:write'] },
    ]);
    expect(sorted(permissions)).toEqual(['inquiries:read', 'pii:view', 'roles:write']);
  });

  it('accepts the built-in roles', () => {
    expect(sorted(permissionsForRoles([BUILTIN_ROLES.viewer, BUILTIN_ROLES.reviewer]))).toEqual(
      sorted(new Set([...BUILTIN_ROLES.viewer.permissions, ...BUILTIN_ROLES.reviewer.permissions])),
    );
  });

  it('fails closed: unknown stored permissions grant nothing', () => {
    expect([...permissionsForRoles([{ permissions: ['inquiries:delete', 'toString'] }])]).toEqual(
      [],
    );
  });

  it('grants nothing without roles', () => {
    expect(permissionsForRoles([]).size).toBe(0);
  });
});

describe('missingPermissions', () => {
  it('lists requested permissions the principal does not hold, in request order', () => {
    const held = new Set<Permission>(['inquiries:read', 'inquiries:write']);
    expect(missingPermissions(held, ['inquiries:read', 'api-keys:write', 'pii:view'])).toEqual([
      'api-keys:write',
      'pii:view',
    ]);
    expect(missingPermissions(held, ['inquiries:write'])).toEqual([]);
  });
});

describe('the Workflow 7B scopes in the built-in roles (C97.3, C102.1, C104.1, C105.6)', () => {
  const has = (key: (typeof BUILTIN_ROLE_KEYS)[number], permission: Permission) =>
    BUILTIN_ROLES[key].permissions.includes(permission);

  it('keeps graph results from viewers, because they are profiling (P11, F29)', () => {
    expect(has('viewer', 'graph:read')).toBe(false);
    expect(has('viewer', 'graph:write')).toBe(false);
    for (const permission of ['lists:read', 'importers:read', 'transactions:read'] as const) {
      expect(has('viewer', permission), permission).toBe(true);
    }
  });

  it('gives developers every list, graph and transaction scope but redaction', () => {
    const developer = PHASE7_SCOPES.filter((scope) => has('developer', scope as Permission));
    expect(developer).toEqual(PHASE7_SCOPES.filter((scope) => scope !== 'transactions:redact'));
  });

  it('gives reviewers what a review needs: matches, the graph, and redaction', () => {
    expect(PHASE7_SCOPES.filter((scope) => has('reviewer', scope as Permission))).toEqual([
      'lists:read',
      'lists:write',
      'importers:read',
      'graph:read',
      'graph:write',
      'transactions:read',
      'transactions:write',
      'transactions:redact',
    ]);
  });

  it('gives admins all of them', () => {
    for (const scope of PHASE7_SCOPES) {
      expect(has('admin', scope as Permission), scope).toBe(true);
    }
  });
});

describe('the Connect permissions in the built-in roles (C240.1)', () => {
  it('gives every built-in role the two Connect reads', () => {
    for (const key of BUILTIN_ROLE_KEYS) {
      for (const scope of PHASE11A_CONNECT_READS) {
        expect(BUILTIN_ROLES[key].permissions, `${key} ${scope}`).toContain(scope);
      }
    }
  });

  it.each([...PHASE11A_CONNECT_ADMIN_SCOPES, 'connect-connections:activate'])(
    'gives %s to admin alone',
    (permission) => {
      expect(BUILTIN_ROLES.admin.permissions).toContain(permission);
      for (const key of ['developer', 'reviewer', 'viewer'] as const) {
        expect(BUILTIN_ROLES[key].permissions, key).not.toContain(permission);
      }
    },
  );

  it('makes the seven scopes API scopes, and activation an operator permission no key can hold', () => {
    for (const scope of PHASE11A_SCOPES) {
      expect(isApiScope(scope), scope).toBe(true);
    }
    expect(isApiScope('connect-connections:activate')).toBe(false);
    expect(isPermission('connect-connections:activate')).toBe(true);
    expect(OPERATOR_PERMISSIONS as readonly string[]).toContain('connect-connections:activate');
  });

  it('never implies attesting a consent by creating tokens (review P03)', () => {
    const tokenWriter = ['connect-share-tokens:write', 'connect-share-tokens:read'].filter(
      isPermission,
    );
    const attest = ['connect-consent-records:attest'].filter(isPermission);
    expect(attest).toHaveLength(1);
    expect(missingPermissions(new Set<Permission>(tokenWriter), attest)).toEqual(attest);
  });
});
