/**
 * C115.2, C125.5: an egress action renders each member for its own sink, last, and hands the message
 * to the messenger with the audit of a marked step to run right before it goes (C121.4). What the
 * messenger answers `unknown` becomes the step's `unknown_effect`, which a resume stops at (C126.5).
 */
import { parseTemplate, renderTemplate, type TemplateSink } from '@openverify/workflow-engine';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
} from '../../engine/action-port.js';
import { auditEgress } from '../https/egress-audit.js';
import type { WorkflowMessage } from './port.js';

/** Whether a member holds no reference at all: a literal, which an allowlist must name. */
export function isLiteral(raw: string): boolean {
  const parsed = parseTemplate(raw);
  return parsed.ok && parsed.template.references.length === 0;
}

/** @throws {ActionStepError} with the render's code; a code, never a value. */
export function renderMember(
  context: Pick<ActionContext, 'scope'>,
  raw: string,
  sink: TemplateSink,
  maxBytes?: number,
): string {
  const parsed = parseTemplate(raw, maxBytes === undefined ? {} : { maxBytes });
  if (!parsed.ok) {
    throw new ActionStepError('execution_error');
  }
  const rendered = renderTemplate(parsed.template, { roots: context.scope.roots }, sink);
  if (!rendered.ok) {
    throw new ActionStepError(rendered.code);
  }
  if (typeof rendered.value !== 'string') {
    throw new ActionStepError('template_type_mismatch');
  }
  return rendered.value;
}

/** Sends through the one port, and says what happened as a step. */
export async function deliverMessage(
  context: ActionContext,
  message: WorkflowMessage,
  flowLink: string | null,
): Promise<ActionResult> {
  const { environmentId, environmentKind, organizationId, runId, stepId, effectKey } = context;
  const output = await context.services.messenger.send(message, {
    environmentId,
    environmentKind,
    organizationId,
    effect: { runId, stepId, effectKey },
    flowLink,
    scrub: [],
    beforeSend: () => auditEgress(context),
  });
  return output.delivery === 'unknown'
    ? { kind: 'unknown', output }
    : { kind: 'succeeded', output };
}
