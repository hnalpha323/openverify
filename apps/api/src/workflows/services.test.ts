/**
 * C143.8 (F05, F11; decision 76): the worker builds the services an action calls once, from the
 * factories `container.ts` uses, and shares what it already holds rather than build it twice.
 */
import { randomBytes } from 'node:crypto';
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { createRecordingEventPublisher, fixedClock } from '../test-support/fakes.js';
import { syntheticEnv } from '../test-support/env.js';
import { egressConfigOf } from './actions/https/egress-config.js';
import { createWorkflowServices, type WorkflowServicesInfra } from './services.js';

const smtp = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('../mail/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mail/index.js')>();
  return {
    ...actual,
    createMailer: (options: Parameters<typeof actual.createMailer>[0]) => {
      smtp.options.push(options);
      return actual.createMailer(options);
    },
  };
});

function infra(): WorkflowServicesInfra {
  return {
    db: {} as Db,
    storage: {} as WorkflowServicesInfra['storage'],
    events: createRecordingEventPublisher(),
    queue: {} as WorkflowServicesInfra['queue'],
    clock: fixedClock(),
    ids: { newId: (prefix) => `${prefix}_synthetic` },
    rateLimiter: {} as WorkflowServicesInfra['rateLimiter'],
    providers: {} as WorkflowServicesInfra['providers'],
    cache: {} as WorkflowServicesInfra['cache'],
    outboundHttp: {} as WorkflowServicesInfra['outboundHttp'],
    reportRuns: {} as WorkflowServicesInfra['reportRuns'],
    listItemEmbeds: undefined,
    graphQueries: undefined,
  };
}

const config = () =>
  loadConfig(
    syntheticEnv({
      OPENVERIFY_SMTP_URL: 'smtp://mail.example.com:1025',
      OPENVERIFY_MAIL_FROM: 'OpenVerify <no-reply@example.com>',
    }),
    { process: 'worker' },
  );

describe('createWorkflowServices (F11)', () => {
  it('builds the one messenger every message goes through (C126.8)', async () => {
    const { messenger } = createWorkflowServices(config(), {
      ...infra(),
      providers: { sandbox: {}, production: {} },
    });

    await expect(
      messenger.send(
        { kind: 'slack', secretKey: 'crm_hook', text: 'Synthetic' },
        {
          environmentId: 'env_1',
          environmentKind: 'sandbox',
          organizationId: 'org_1',
          effect: null,
          flowLink: null,
          scrub: [],
        },
      ),
    ).rejects.toMatchObject({ code: 'provider_not_configured' });
  });

  it('records a sandbox environment’s mail, and a production one reads the real mailer (C126.4)', () => {
    const services = createWorkflowServices(config(), infra());

    expect(services.mail.sandbox.sandbox).toBe(true);
    expect(services.mail.production).toBe(services.mailer);
  });

  it('shares what the worker holds', () => {
    const held = infra();
    const services = createWorkflowServices(config(), held);

    expect(services.db).toBe(held.db);
    expect(services.events).toBe(held.events);
    expect(services.clock).toBe(held.clock);
    expect(services.providers).toBe(held.providers);
  });

  it('builds the services an action calls', () => {
    const services = createWorkflowServices(config(), infra());

    expect(typeof services.accounts.resolveForInquiry).toBe('function');
    expect(typeof services.redaction.redactInquiry).toBe('function');
    expect(typeof services.audit.record).toBe('function');
    expect(typeof services.listService?.createItem).toBe('function');
    expect(typeof services.biometricListsGate?.isAcknowledged).toBe('function');
  });

  it('reads the keys and the links from the configuration', () => {
    const loaded = config();
    const services = createWorkflowServices(loaded, infra());

    expect(services.keyring).toBe(loaded.keyring);
    expect(services.blindIndexKey).toBe(loaded.blindIndexKey);
    expect(services.flowPublicUrl).toBe(loaded.flowPublicUrl);
    expect(services.reportLimits).toBe(loaded.reports);
  });

  it('builds the mailer from the worker’s SMTP settings (C143.8, decision 76)', () => {
    smtp.options.length = 0;

    const services = createWorkflowServices(config(), infra());

    expect(services.mailer.configured).toBe(true);
    expect(smtp.options).toEqual([
      expect.objectContaining({ smtpUrl: 'smtp://mail.example.com:1025' }),
    ]);
  });

  it('reads the install’s egress settings and builds the runner it names (C123.7, C124.3)', async () => {
    const egress = egressConfigOf(createWorkflowServices(config(), infra()));

    expect(egress.codeEnabled).toBe(true);
    expect(egress.codeRunner).not.toBeNull();
    await egress.codeRunner?.close();
  });

  it('builds no runner with code turned off, which says so rather than errors (C123.7)', () => {
    const off = loadConfig(syntheticEnv({ OPENVERIFY_WORKFLOW_CODE_ENABLED: 'false' }), {
      process: 'worker',
    });

    expect(egressConfigOf(createWorkflowServices(off, infra()))).toMatchObject({
      codeEnabled: false,
      codeRunner: null,
    });
  });

  it('takes no key from anywhere else', () => {
    const other = randomBytes(32);

    expect(createWorkflowServices(config(), infra()).blindIndexKey).not.toEqual(other);
  });
});
