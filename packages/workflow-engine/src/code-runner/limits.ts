/**
 * C123.5: what one evaluation may use. A step sets `time-ms` and `memory-bytes` up to the install's
 * ceilings (Stage 1a amendment 24), the WebAssembly maximum is the QuickJS limit plus the headroom,
 * and every other limit is fixed. Past a ceiling is read as the ceiling, the safe direction, though
 * the step's config schema refuses it first. An evaluation the contract refuses never reaches a
 * child: the action sizes its input (C123.2), and this check holds whatever the caller did.
 */
import { availableParallelism } from 'node:os';
import { idSchema } from '@openverify/contracts';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import { jsonDepthWithin } from './frames.js';
import type { CodeRunnerRequest, EvaluationLimits } from './protocol.js';
import type { CodeEvaluation } from './runner.js';

export type EvaluateRequest = Extract<CodeRunnerRequest, { kind: 'evaluate' }>;

const limitOf = (name: keyof typeof EVALUATE_CODE_LIMITS): number =>
  EVALUATE_CODE_LIMITS[name].value;

const environmentIdSchema = idSchema('env');

export function defaultPoolSize(cpus: number = availableParallelism()): number {
  return Math.max(1, cpus - 1);
}

export function resolveEvaluationLimits(limits?: CodeEvaluation['limits']): EvaluationLimits {
  const memoryBytes = Math.min(
    limits?.memoryBytes ?? limitOf('memory-bytes'),
    limitOf('memory-bytes-ceiling'),
  );
  return {
    'time-ms': Math.min(limits?.timeMs ?? limitOf('time-ms'), limitOf('time-ms-ceiling')),
    'memory-bytes': memoryBytes,
    'wasm-maximum-bytes': memoryBytes + limitOf('wasm-headroom-bytes'),
    'stack-bytes': limitOf('stack-bytes'),
  };
}

/** The container reads these off a frame, so it checks them again before a child does. */
export function requestLimitsAllowed(limits: EvaluationLimits): boolean {
  return (
    limits['time-ms'] <= limitOf('time-ms-ceiling') &&
    limits['memory-bytes'] <= limitOf('memory-bytes-ceiling') &&
    limits['wasm-maximum-bytes'] === limits['memory-bytes'] + limitOf('wasm-headroom-bytes') &&
    limits['stack-bytes'] <= limitOf('stack-bytes')
  );
}

function inputText(input: CodeEvaluation['input']): string | null {
  try {
    return JSON.stringify(input);
  } catch {
    return null;
  }
}

/** What the container checks on a request off a frame, before a child sees it. */
export function evaluateRequestAllowed(request: EvaluateRequest): boolean {
  return (
    requestLimitsAllowed(request.limits) &&
    Buffer.byteLength(request.source, 'utf8') <= limitOf('source-bytes') &&
    Buffer.byteLength(request.input, 'utf8') <= limitOf('input-bytes') &&
    jsonDepthWithin(request.input, limitOf('input-depth'))
  );
}

/** The request for one evaluation, or `null` when the contract refuses it. */
export function prepareEvaluateRequest(
  evaluation: CodeEvaluation,
  id: string,
): EvaluateRequest | null {
  const { environmentId, source } = evaluation;
  const input = inputText(evaluation.input);
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (
    sourceBytes === 0 ||
    sourceBytes > limitOf('source-bytes') ||
    input === null ||
    Buffer.byteLength(input, 'utf8') > limitOf('input-bytes') ||
    !jsonDepthWithin(input, limitOf('input-depth')) ||
    !environmentIdSchema.safeParse(environmentId).success
  ) {
    return null;
  }
  return {
    kind: 'evaluate',
    id,
    'environment-id': environmentId,
    source,
    input,
    limits: resolveEvaluationLimits(evaluation.limits),
    console: evaluation.captureConsole ?? false,
  };
}
