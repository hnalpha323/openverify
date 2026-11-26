/**
 * What the install says about egress and code, which an action cannot read from an environment's
 * settings. `createWorkflowServices` builds it once from `config.workflows`; until a process passes
 * it, the action reads the closed defaults: no loopback, no NAT64 prefix and no code runner, so
 * Evaluate Code errors `provider_not_configured` and nothing is lifted.
 */
import {
  connectCodeRunner,
  connectCodeRunnerOverTcp,
  createCodeRunnerPool,
  type CodeRunner,
} from '@openverify/workflow-engine/code-runner';
import type { WorkflowSettings } from '../../../config.js';
import type { WorkflowServices } from '../../services.js';

export interface WorkflowEgressConfig {
  /** `OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK`, for a sandbox's local test receivers. */
  httpAllowLoopback: boolean;
  /** `OPENVERIFY_NAT64_PREFIXES`. */
  nat64Prefixes: readonly string[];
  /** `OPENVERIFY_WORKFLOW_CODE_ENABLED`. */
  codeEnabled: boolean;
  /** `null` with code turned off; the worker closes it at shutdown. */
  codeRunner: CodeRunner | null;
}

const CLOSED: WorkflowEgressConfig = Object.freeze({
  httpAllowLoopback: false,
  nat64Prefixes: Object.freeze([]),
  codeEnabled: true,
  codeRunner: null,
});

/** The worker's one line in `createWorkflowServices`. */
export function createWorkflowEgressConfig(settings: WorkflowSettings): WorkflowEgressConfig {
  const { codeEnabled, codeRunner, httpAllowLoopback, nat64Prefixes } = settings;
  const runner = (): CodeRunner => {
    switch (codeRunner.kind) {
      case 'pool':
        return createCodeRunnerPool();
      case 'socket':
        return connectCodeRunner(codeRunner.path);
      case 'tcp': {
        // C263.6: config.ts requires the token in the worker; the API never builds a runner.
        const { host, port, token } = codeRunner;
        // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
        if (token === null) {
          throw new Error('OPENVERIFY_CODE_RUNNER_TOKEN is required for the tcp: code runner');
        }
        return connectCodeRunnerOverTcp({ host, port, token });
      }
    }
  };
  return {
    httpAllowLoopback,
    nat64Prefixes,
    codeEnabled,
    codeRunner: codeEnabled ? runner() : null,
  };
}

export const egressConfigOf = (services: WorkflowServices): WorkflowEgressConfig =>
  (services as Partial<WorkflowServices>).egress ?? CLOSED;
