/**
 * C127.8, Stage 1a amendment 6: `redact_object`, through `RedactionService`, needing
 * `irreversible:<step id>` at publish. A redaction commits in stages and deletes objects after, so it
 * cannot share a transaction with an effect: the effect is claimed first and the service is idempotent
 * on `redacted_at`, so a repeated attempt reads `no_change`. A run redacts at most 100 objects
 * (decision 42). A redacted subject is `no_change`, never an error.
 */
import { listWorkflowRunEffects } from '@openverify/db';
import {
  redactObjectConfigSchema,
  type RedactObjectConfig,
} from '@openverify/workflow-engine/actions';
import type { ActionContext, OutsideActionHandler } from '../../engine/action-port.js';
import { answering, configOf } from '../shared.js';

/** Decision 42. */
export const RUN_REDACTION_LIMIT = 100;

async function redact(context: ActionContext, config: RedactObjectConfig) {
  const { redaction } = context.services;
  const { ctx, actor } = context.acting;
  const id = config['object-id'];
  switch (config['object-type']) {
    case 'inquiry':
      return redaction.redactInquiry(ctx, id, actor);
    case 'account':
      return redaction.redactAccount(ctx, id, actor);
    case 'report':
      return redaction.redactReport(ctx, id, actor);
    // Workflow 8B (C140.3): a case through its own redaction (C139.1).
    case 'case':
      return redaction.redactCase(ctx, id, actor);
    default:
      return redaction.redactTransaction(ctx, id, actor, { includeNever: false });
  }
}

export const REDACT_OBJECT_HANDLER: OutsideActionHandler = {
  key: 'redact_object',
  version: 1,
  shape: 'outside',
  execute: (context) =>
    answering(async () => {
      const config = configOf(context, redactObjectConfigSchema);
      const id = config['object-id'];
      const effects = await listWorkflowRunEffects(
        context.services.db,
        context.environmentId,
        context.runId,
      );
      const done = effects.filter(
        ({ kind, status }) => kind === 'redact_object' && status === 'done',
      );
      if (done.length >= RUN_REDACTION_LIMIT) {
        return { kind: 'failed', code: 'redaction_limit_exceeded' };
      }
      const result = await redact(context, config);
      return {
        kind: 'succeeded',
        output: {
          'object-id': id,
          outcome: result.alreadyRedacted ? 'no_change' : 'applied',
        },
      };
    }),
};
