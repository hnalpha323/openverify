/**
 * C123: Evaluate Code over the code runner. Only mapped properties reach the code, the source's digest
 * is recorded on every outcome, and a failed evaluation's words are the guest's own text (P18): they
 * go in the step's sealed output, cut to 1 KiB, and the plaintext columns take the code alone. Pure,
 * so it has no effect row, and a retry follows only the two failures a retry can change (C117.6).
 */
import { createHash } from 'node:crypto';
import { hasSecretReference } from '@openverify/contracts';
import type { JsonValue } from '@openverify/workflow-engine';
import {
  EVALUATE_CODE_DETERMINISTIC_ERRORS,
  EVALUATE_CODE_LIMITS,
  evaluateCodeConfigSchema,
  evaluateCodeValueFits,
  type EvaluateCodeConfig,
  type EvaluateCodeErrorCode,
} from '@openverify/workflow-engine/actions';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type OutsideActionHandler,
} from '../../engine/action-port.js';
import { consumeBudget, workflowPolicyRule } from '../https/budgets.js';
import { egressConfigOf } from '../https/egress-config.js';
import { answering } from '../shared.js';

const MESSAGE_BYTES = EVALUATE_CODE_LIMITS['error-message-bytes'].value;
/** C117.4: the action's limit plus a margin, of which the kill takes a quarter of a second. */
const LEASE_MARGIN_SECONDS = 30;

const digestOf = (source: string): string => createHash('sha256').update(source).digest('hex');

/** At most 1 KiB, cut on a character boundary. */
function cutMessage(message: string | null): string | null {
  if (message === null) {
    return null;
  }
  const bytes = Buffer.from(message, 'utf8');
  return bytes.byteLength <= MESSAGE_BYTES
    ? message
    : new TextDecoder().decode(bytes.subarray(0, MESSAGE_BYTES)).replace(/�$/u, '');
}

/**
 * The config as the step holds it: `source` as written, because code is no template, and the
 * properties as the engine rendered them.
 */
function configOf(context: ActionContext): EvaluateCodeConfig {
  const { step } = context;
  const written = step.type === 'action' ? step.config : {};
  if (hasSecretReference(JSON.stringify(written.properties ?? {}))) {
    throw new ActionStepError('secret_placement_refused');
  }
  const parsed = evaluateCodeConfigSchema.safeParse({ ...context.config, source: written.source });
  if (!parsed.success) {
    throw new ActionStepError('action_input_invalid');
  }
  return parsed.data;
}

function failure(
  code: EvaluateCodeErrorCode,
  message: string | null,
  digest: string,
): ActionResult {
  return {
    kind: 'failed',
    code,
    retryable: !EVALUATE_CODE_DETERMINISTIC_ERRORS.has(code),
    output: { error: { code, message: cutMessage(message) }, 'source-sha256': digest },
  };
}

async function execute(context: ActionContext): Promise<ActionResult> {
  const egress = egressConfigOf(context.services);
  if (!egress.codeEnabled) {
    return { kind: 'failed', code: 'code_disabled' };
  }
  const { codeRunner } = egress;
  if (codeRunner === null) {
    return { kind: 'failed', code: 'provider_not_configured' };
  }
  const config = configOf(context);
  const { environmentId, testRun } = context;
  await consumeBudget(
    context.services.rateLimiter,
    environmentId,
    workflowPolicyRule('workflow-code'),
  );
  const digest = digestOf(config.source);
  const limits = config.limits;
  const result = await codeRunner.evaluate({
    environmentId,
    source: config.source,
    input: config.properties,
    ...(limits === undefined
      ? {}
      : {
          limits: {
            ...(limits['time-ms'] === undefined ? {} : { timeMs: limits['time-ms'] }),
            ...(limits['memory-bytes'] === undefined
              ? {}
              : { memoryBytes: limits['memory-bytes'] }),
          },
        }),
    captureConsole: testRun !== null,
  });
  if (!result.ok) {
    return failure(result.code, result.message, digest);
  }
  const value = result.value as JsonValue;
  if (!evaluateCodeValueFits(config['return-type'], value)) {
    return failure('type_mismatch', null, digest);
  }
  return {
    kind: 'succeeded',
    output: { value, 'source-sha256': digest },
    console: result.console,
  };
}

export const EVALUATE_CODE_HANDLER: OutsideActionHandler = {
  key: 'evaluate_code',
  version: 1,
  shape: 'outside',
  leaseSeconds: (config) => {
    const limits = config.limits as { 'time-ms'?: unknown } | undefined;
    const limit =
      typeof limits?.['time-ms'] === 'number'
        ? limits['time-ms']
        : EVALUATE_CODE_LIMITS['time-ms'].value;
    return Math.ceil(limit / 1_000) + LEASE_MARGIN_SECONDS;
  },
  execute: (context) => answering(() => execute(context)),
};
