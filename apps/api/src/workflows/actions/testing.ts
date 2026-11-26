/**
 * Test helpers for the object actions: the engine harness with the handlers of `index.ts` and the real
 * services an action reaches, on PGlite, so a suite proves the step from claim to completion. Only
 * tests import this file. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { listInquiryDecisions, type InquiryDecision } from '@openverify/db';
import { createAccountsService } from '../../services/accounts.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { biometricListsGate } from '../../services/lists/biometric/index.js';
import { createListService } from '../../services/lists/item-writer.js';
import { createRedactionService } from '../../services/redaction.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createRecordingGraphQueryQueue,
  createRecordingQueue,
  createRecordingReportRunQueue,
  fixedClock,
} from '../../test-support/fakes.js';
import { ulidIdGenerator } from '../../ports.js';
import { createEngineHarness, drain, runOf, start, type EngineHarness } from '../engine/testing.js';
import type { WorkflowDefinition } from '@openverify/contracts';
import type { StartWorkflowRunInput } from '../engine/start-run.js';
import type { WorkflowServices } from '../services.js';
import { OBJECT_ACTION_HANDLERS } from './index.js';

export const EVERY_GRANT = {
  scopes: [
    'inquiries:read',
    'inquiries:write',
    'inquiries:redact',
    'inquiry-sessions:write',
    'accounts:read',
    'accounts:write',
    'accounts:redact',
    'reports:read',
    'reports:write',
    'reports:redact',
    'lists:read',
    'lists:write',
    'graph:read',
    'graph:write',
    'transactions:read',
    'transactions:write',
    'transactions:redact',
    'verifications:read',
    'devices:write',
  ],
  pii: true,
} as const;

export interface ActionHarness extends EngineHarness {
  run(
    definition: WorkflowDefinition,
    input?: Partial<StartWorkflowRunInput>,
  ): Promise<{
    id: string;
    status: string;
    errorCode: string | null;
  }>;
  decisions(subjectId: string): Promise<InquiryDecision[]>;
  services: WorkflowServices;
}

export async function createActionHarness(
  options: { environmentKind?: 'sandbox' | 'production' } = {},
): Promise<ActionHarness> {
  const harness = await createEngineHarness(OBJECT_ACTION_HANDLERS, options);
  const { db, events } = harness;
  const clock = fixedClock(new Date());
  const storage = createInMemoryFileStorage();
  const audit = createAuditLogger();
  const rateLimiter = createAllowAllRateLimiter();
  const blindIndexKey = randomBytes(32);
  const ids = ulidIdGenerator;
  const services = Object.assign(harness.deps.services, {
    clock,
    storage,
    audit,
    rateLimiter,
    blindIndexKey,
    accounts: createAccountsService({ events, ids }),
    redaction: createRedactionService({ db, storage, events, clock, audit }),
    listService: createListService({ db, blindIndexKey, rateLimiter, events }),
    biometricListsGate,
    reportRuns: createRecordingReportRunQueue(),
    graphQueries: createRecordingGraphQueryQueue(),
    queue: createRecordingQueue(),
    reportLimits: { maxRecurring: 1_000 },
    flowPublicUrl: 'https://flow.example.test',
  }) as WorkflowServices;
  return {
    ...harness,
    services,
    decisions: async (subjectId) =>
      (await listInquiryDecisions(db, harness.environmentId, subjectId, { size: 100 })).items,
    async run(definition, input = {}) {
      const id = await start(harness, definition, { grant: EVERY_GRANT, ...input });
      await drain(harness);
      const run = await runOf(harness, id);
      return { id, status: run.status, errorCode: run.errorCode };
    },
  };
}

export { action, chain, stepOf } from '../engine/testing.js';
