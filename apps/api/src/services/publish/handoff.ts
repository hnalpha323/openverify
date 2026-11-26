/**
 * C96.1 (Workflow 7A; F30, decisions 23 and 52): the publish rules of a flow's `device_handoff`
 * steps, which `assertPublishable` (`services/inquiry-templates.ts`) runs when a template is created
 * and when a version is published:
 *
 * - `sms` among the step's methods while no SMS adapter is bound in the environment: 422
 *   `sms_not_configured` at `/data/attributes/flow/steps/<i>/methods`;
 * - the environment's `organization-display-name` (C107.7) is empty: 422 `display_name_required`
 *   at `/data/attributes/flow/steps/<i>`, because the phone's context screen shows it.
 *
 * Owner: `flow-handoff`; the signature is frozen by `foundation-7a` (Stage 1b (H)).
 */
import type { SignalProblemCode } from '@openverify/contracts';
import { getEnvironment, type Db } from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { EnvironmentKind } from '../../ports.js';
import type { ApiDependencies } from '../context.js';

export interface HandoffPublishContext {
  deps: ApiDependencies;
  /** The request's database, or the transaction that publishes. */
  db: Db;
  environment: { id: string; kind: EnvironmentKind };
  flow: Flow;
}

/** One refusal: its code and a JSON Pointer into the request (`/data/attributes/...`). */
export interface HandoffPublishProblem {
  code: SignalProblemCode;
  pointer: string;
  detail: string;
}

export async function handoffPublishProblems(
  ctx: HandoffPublishContext,
): Promise<HandoffPublishProblem[]> {
  const steps = ctx.flow.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type === 'device_handoff');
  if (steps.length === 0) {
    return [];
  }
  const smsBound = ctx.deps.providers[ctx.environment.kind].sms !== undefined;
  const environment = await getEnvironment(ctx.db, ctx.environment.id);
  const name = environment?.settings['organization-display-name'];
  const named = typeof name === 'string' && name.length > 0;
  const problems: HandoffPublishProblem[] = [];
  for (const { step, index } of steps) {
    const at = `/data/attributes/flow/steps/${String(index)}`;
    if (step.type === 'device_handoff' && step.methods?.includes('sms') === true && !smsBound) {
      problems.push({
        code: 'sms_not_configured',
        pointer: `${at}/methods`,
        detail: 'A handoff by SMS needs an SMS adapter bound in this environment.',
      });
    }
    if (!named) {
      problems.push({
        code: 'display_name_required',
        pointer: at,
        detail:
          'A device_handoff step needs the environment’s organization-display-name, which the phone shows.',
      });
    }
  }
  return problems;
}
