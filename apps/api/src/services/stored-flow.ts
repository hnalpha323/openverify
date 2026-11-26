/**
 * Workflow 9A Stage 1b (S) (plan outcome 10; inventory 3): the one reader of a template version's
 * stored flow. A stored flow is flow-spec 1 or 2 (C147.1), and stored versions are never rewritten,
 * so no reader may parse it as v1 only: before this reader, a v2 flow failed every signal
 * computation and every verification of its inquiries.
 *
 * - {@link storedAnyFlow}: the flow as stored, either version, for whatever serves or checks it
 *   whole (the template resources, publish).
 * - {@link storedFlowView}: a v1 view for the consumers that walk steps by type (Phase 1-8 code:
 *   the verification jobs, the signal computation, the OTP, input, chip, crypto and handoff
 *   services). A v1 flow is returned as it is. A v2 flow gives its steps of v1 types in list order
 *   without v2's additive members (`captureMethodsByDevice`, `onFallback`, `prefillFrom`, the
 *   failure step's bases), and leaves out `screen`, `branch` and `action`, which those consumers do
 *   not know; it has no transitions, because v2 runs along edges the server engine walks
 *   (`advanceFlowInTx`), never a client or a v1 consumer.
 *
 * Neither reader evaluates anything (rule 18).
 */
import {
  isFlowV2,
  parseAnyFlow,
  safeParseAnyFlow,
  stepSchema,
  V2_ONLY_STEP_TYPES,
  type AnyFlow,
  type Flow,
  type FlowStep,
  type FlowV2,
} from '@openverify/flow-spec';

/** The members C147.3 adds to v2 steps of v1 types, which the strict v1 step schemas refuse. */
const V2_ADDITIVE_MEMBERS = [
  'captureMethodsByDevice',
  'onFallback',
  'prefillFrom',
  'decisionBasis',
  'contestRoute',
  'biometricBasis',
] as const;

/**
 * The v2 step types no v1 consumer knows (C147.3): flow-spec's own list, so a later v2-only type
 * (Workflow 11A's `share_consent`) stays out of the v1 view too.
 */
const V2_ONLY_TYPES: ReadonlySet<string> = new Set(V2_ONLY_STEP_TYPES);

/**
 * The stored flow as written, flow-spec 1 or 2.
 * @throws {import('@openverify/flow-spec').FlowSpecError} when the stored document is no valid flow.
 */
export function storedAnyFlow(flow: unknown): AnyFlow {
  return parseAnyFlow(flow);
}

/** The v1 view of a parsed flow (see the module comment). */
export function flowViewOf(flow: AnyFlow): Flow {
  return isFlowV2(flow) ? v1ViewOfV2(flow) : flow;
}

/**
 * The v1 view of a stored flow (see the module comment).
 * @throws {import('@openverify/flow-spec').FlowSpecError} when the stored document is no valid flow.
 */
export function storedFlowView(flow: unknown): Flow {
  return flowViewOf(storedAnyFlow(flow));
}

/** {@link storedFlowView}, or `null` when the stored document is no valid flow of either version. */
export function safeStoredFlowView(flow: unknown): Flow | null {
  const parsed = safeParseAnyFlow(flow);
  return parsed.success ? flowViewOf(parsed.data) : null;
}

function v1ViewOfV2(flow: FlowV2): Flow {
  const additive: ReadonlySet<string> = new Set(V2_ADDITIVE_MEMBERS);
  const steps: FlowStep[] = [];
  for (const step of flow.steps) {
    if (V2_ONLY_TYPES.has(step.type)) {
      continue;
    }
    steps.push(
      stepSchema.parse(
        Object.fromEntries(Object.entries(step).filter(([key]) => !additive.has(key))),
      ),
    );
  }
  return { metadata: { ...flow.metadata, specVersion: 1 }, steps, transitions: [] };
}
