/**
 * C231.10, C243.1 (Phase 11, Workflow 11A, `workflow-connect`): what Connect's steps read in the
 * worker. The services a step reaches carry the install switch from the configuration, so a step
 * answers the one 404 while `OPENVERIFY_CONNECT_ENABLED` is off, and share the `connect-redeem`
 * producer the worker holds, without which a redemption fails closed. Every value is synthetic.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../config.js';
import type { ConnectRedeemQueue } from '../../../jobs/connect-queues.js';
import { createRecordingEventPublisher, fixedClock } from '../../../test-support/fakes.js';
import { syntheticEnv } from '../../../test-support/env.js';
import { createWorkflowServices, type WorkflowServicesInfra } from '../../services.js';

const infra = (more: Partial<WorkflowServicesInfra> = {}): WorkflowServicesInfra => ({
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
  ...more,
});

const config = (enabled: string | undefined) =>
  loadConfig(
    syntheticEnv({
      OPENVERIFY_SMTP_URL: 'smtp://mail.example.com:1025',
      OPENVERIFY_MAIL_FROM: 'OpenVerify <no-reply@example.com>',
      ...(enabled === undefined ? {} : { OPENVERIFY_CONNECT_ENABLED: enabled }),
    }),
    { process: 'worker' },
  );

describe('the services Connect’s steps reach (C231.10, C243.1)', () => {
  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
  ] as const)('carry the install switch (OPENVERIFY_CONNECT_ENABLED=%s)', (value, enabled) => {
    expect(createWorkflowServices(config(value), infra()).connect).toEqual({ enabled });
  });

  it('share the worker’s redemption producer, and have none without it', () => {
    const producer: ConnectRedeemQueue = { enqueueConnectRedeem: () => Promise.resolve() };

    expect(
      createWorkflowServices(config('true'), infra({ connectRedeems: producer })).connectRedeems,
    ).toBe(producer);
    expect(createWorkflowServices(config('true'), infra()).connectRedeems).toBeUndefined();
  });
});
