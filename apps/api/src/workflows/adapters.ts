/**
 * C122.5: which adapters a step of an environment kind can reach. Steps run in the worker, and the API
 * process binds neither Slack nor the code runner (outcome 21), so the catalogue and the publish rules
 * read facts rather than bindings: Stage 1b amendment 52. A sandbox's mail goes to its sandbox list,
 * so it needs no SMTP server.
 */
import type { ActionAdapter } from '@openverify/workflow-engine/actions';
import type { EnvironmentKind } from '../ports.js';
import type { ApiDependencies } from '../services/context.js';

export interface WorkflowAdapterFacts {
  slackBound: Readonly<Record<EnvironmentKind, boolean>>;
  codeEnabled: boolean;
}

/** A process given no facts binds nothing it cannot see, and code stays on (decision 30). */
const NO_FACTS: WorkflowAdapterFacts = {
  slackBound: { sandbox: false, production: false },
  codeEnabled: true,
};

export function boundAdaptersOf(
  deps: Pick<ApiDependencies, 'mailer' | 'providers' | 'workflowAdapters'>,
  kind: EnvironmentKind,
): ReadonlySet<ActionAdapter> {
  const facts = deps.workflowAdapters ?? NO_FACTS;
  const bound = new Set<ActionAdapter>(['none']);
  if (facts.codeEnabled) {
    bound.add('code-runner');
  }
  if (kind === 'sandbox' || deps.mailer.configured) {
    bound.add('mailer');
  }
  if (deps.providers[kind].sms != null) {
    bound.add('sms');
  }
  if (facts.slackBound[kind]) {
    bound.add('slack');
  }
  return bound;
}
