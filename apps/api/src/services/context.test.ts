import { describe, expect, it } from 'vitest';
import type { Principal } from '../ports.js';
import { auditEntryOf, dependenciesOf, serviceContextOf, type ApiDependencies } from './context.js';

/** Lists exactly the keys of `T`: the compiler rejects a missing or extra key. */
const keysOf = <T>(keys: Record<keyof T, true>): string[] => Object.keys(keys).sort();

const DEPENDENCY_KEYS = keysOf<ApiDependencies>({
  db: true,
  keyring: true,
  storage: true,
  events: true,
  queue: true,
  clock: true,
  ids: true,
  flowPublicUrl: true,
  dashboardPublicUrl: true,
  flowCorsOrigins: true,
  accounts: true,
  redaction: true,
  audit: true,
  rateLimiter: true,
  mailer: true,
  // C54.3: the Workflow 5A dependencies.
  providers: true,
  blindIndexKey: true,
  cache: true,
  outboundHttp: true,
  otpSmsMaxPerHourCeiling: true,
  // C62.7, Workflow 5C review K13: the trust-store settings the console reports.
  nfc: true,
  // C72.5 (Phase 6): the per-environment report limits.
  reportLimits: true,
  reportRuns: true,
  // C93.2 (Phase 7): the session start's network evaluation.
  network: true,
  // C96.3 (Phase 7): the handoff send budget.
  handoffSendsPerHour: true,
  listImports: true,
  // C211.4 (Workflow 10B Stage 1b (I)).
  integrityDecodes: true,
  connect: true,
  connectRedeems: true,
  accountExports: true,
  queueInFlightCapMax: true,
  listItemEmbeds: true,
  // C102.4 (Workflow 7B): the graph-query producer.
  graphQueries: true,
  listService: true,
  workflowSteps: true,
  workflowInFlightCap: true,
  workflowAdapters: true,
  caseBulk: true,
  caseExports: true,
  caseAttachmentScans: true,
  caseRenditions: true,
  flowSignalSnapshots: true,
  // C157.2 (Workflow 9A Stage 1b (F)): the flow server's tokens, for the internal embed-policy route.
  flowServerTokens: true,
  attachmentScanners: true,
  // C166.1, C166.5 (Workflow 9B Stage 1b (X)): the export and bulk report producers.
  exports: true,
  reportBulk: true,
  biometricListsGate: true,
  // C160.6 (Workflow 9B, integration-9b): the theme logo renditions.
  vision: true,
  resolveUserSession: true,
});

/** A stand-in for each port: only its identity matters here. */
function sentinelDependencies(): ApiDependencies {
  const entries = DEPENDENCY_KEYS.map((key): [string, unknown] => [key, { sentinel: key }]);
  return Object.fromEntries(entries) as unknown as ApiDependencies;
}

describe('dependenciesOf', () => {
  it('passes on every dependency, including the Phase 2 ports, by reference', () => {
    const deps = sentinelDependencies();

    const copied = dependenciesOf(deps);

    expect(Object.keys(copied).sort()).toEqual(DEPENDENCY_KEYS);
    for (const key of DEPENDENCY_KEYS) {
      expect(copied[key as keyof ApiDependencies], key).toBe(deps[key as keyof ApiDependencies]);
    }
  });

  it("drops Fastify's own register options, such as the prefix", () => {
    const options = { ...sentinelDependencies(), prefix: '/api/v1', logLevel: 'warn' };

    expect(dependenciesOf(options)).not.toHaveProperty('prefix');
    expect(dependenciesOf(options)).not.toHaveProperty('logLevel');
  });

  it('keeps an absent user-session resolver absent', () => {
    const withoutResolver = Object.fromEntries(
      Object.entries(sentinelDependencies()).filter(([key]) => key !== 'resolveUserSession'),
    ) as unknown as ApiDependencies;

    expect(dependenciesOf(withoutResolver).resolveUserSession).toBeUndefined();
  });
});

const principal: Principal = {
  kind: 'user',
  userId: 'usr_01M5CJXHG0000000000000000A',
  userSessionId: 'uss_01M5CJXHG0000000000000000A',
  organizationId: 'org_01M5CJXHG0000000000000000A',
  environmentId: 'env_01M5CJXHG0000000000000000A',
  environmentKind: 'sandbox',
  permissions: new Set(['inquiries:write']),
  mfaSatisfied: true,
};

describe('serviceContextOf', () => {
  it("scopes a service call to the principal's organization and environment", () => {
    expect(serviceContextOf(principal)).toEqual({
      organizationId: 'org_01M5CJXHG0000000000000000A',
      environmentId: 'env_01M5CJXHG0000000000000000A',
    });
  });

  it('carries the request metadata that audit entries record', () => {
    expect(
      serviceContextOf(principal, {
        requestId: 'req-synthetic-1',
        ipAddress: '192.0.2.10',
        userAgent: 'SyntheticAgent/1.0',
      }),
    ).toEqual({
      organizationId: 'org_01M5CJXHG0000000000000000A',
      environmentId: 'env_01M5CJXHG0000000000000000A',
      requestId: 'req-synthetic-1',
      ipAddress: '192.0.2.10',
      userAgent: 'SyntheticAgent/1.0',
    });
  });
});

describe('auditEntryOf', () => {
  it('fills the tenant and request metadata of an audit entry from the context', () => {
    const ctx = serviceContextOf(principal, { requestId: 'req-1', ipAddress: '192.0.2.10' });

    expect(
      auditEntryOf(
        ctx,
        { type: 'user', id: principal.userId },
        {
          action: 'inquiry.approved',
          resourceType: 'inquiry',
          resourceId: 'inq_01M5CJXHG0000000000000000A',
          metadata: { from: 'needs_review' },
        },
      ),
    ).toEqual({
      environmentId: 'env_01M5CJXHG0000000000000000A',
      organizationId: 'org_01M5CJXHG0000000000000000A',
      actor: { type: 'user', id: 'usr_01M5CJXHG0000000000000000A' },
      action: 'inquiry.approved',
      resourceType: 'inquiry',
      resourceId: 'inq_01M5CJXHG0000000000000000A',
      requestId: 'req-1',
      ipAddress: '192.0.2.10',
      metadata: { from: 'needs_review' },
    });
  });

  it('leaves out metadata the context does not have', () => {
    const entry = auditEntryOf(
      serviceContextOf(principal),
      { type: 'api-key', id: 'key_1' },
      {
        action: 'webhook.secret-rotated',
        resourceType: 'webhook',
        resourceId: 'wbh_01M5CJXHG0000000000000000A',
      },
    );

    expect(Object.keys(entry).sort()).toEqual([
      'action',
      'actor',
      'environmentId',
      'organizationId',
      'resourceId',
      'resourceType',
    ]);
  });
});
