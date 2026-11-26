/**
 * C122.1, C117.3, C117.5: what the step executor asks of an action. The registry entry says what an
 * action is (`@openverify/workflow-engine/actions`); a handler here is how it runs, by `key@version`.
 *
 * A handler has one of two shapes, because C117.5 gives two transactions:
 *
 * - `transaction`: an internal effect. `execute` writes through the target service's `…InTx` form on
 *   the transaction it is given, which also holds the effect row and the step's completion, so the
 *   effect is exactly once. The step's run row is locked after `execute`, last, because every domain
 *   path (a redaction above all) locks its object before it reaches a run. A handler that has written
 *   and then cannot go on throws {@link ActionStepError}, so nothing it wrote commits.
 * - `outside`: anything that leaves the database, and anything slow. `execute` holds no transaction.
 *   The registry's `delivery` then decides the effect row: `at-most-once` is claimed before the call
 *   and `done` after, so a crash leaves `unknown` (C126.1); `at-least-once` is re-run until `done`
 *   (C124.6); `exactly-once` here is an idempotent service that commits in stages (`redact_object`,
 *   Stage 1a amendment 6); `pure` has no effect row and its output is recorded on the step.
 *
 * What a handler answers is {@link ActionResult}. It never touches a step or a run row, a claim, or a
 * retry: `failed` with `retryable` is enough, and the engine owns the rest (C117.6). A failed
 * attempt's text goes in `output`, sealed; the plaintext columns take `code` alone (C120.2).
 */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import type { ApiScope } from '@openverify/core';
import type { Db, WorkflowEffectCopy } from '@openverify/db';
import type { ActionRegistry, AnyActionRegistryEntry } from '@openverify/workflow-engine/actions';
import type { EvaluationScope, JsonRecord, JsonValue, RunState } from '@openverify/workflow-engine';
import type { StagedEvent } from '../../events/index.js';
import type { WorkflowRunSubject } from '@openverify/db';
import type { Acting } from '../../services/inquiries.js';
import type { WorkflowServices } from '../services.js';
import type { EngineDeps } from './deps.js';

/** C121.2: a run's frozen, effective grant. */
export interface RunGrant {
  readonly scopes: readonly ApiScope[];
  readonly pii: boolean;
}

/** C120.7: what a test run asked for; `null` for every other run. */
export interface ActionTestRun {
  /** The run's own id: its objects and decision records carry it. */
  readonly id: string;
  readonly allowHosts: readonly string[];
  readonly acknowledgements: readonly string[];
}

export interface ActionContext {
  readonly services: WorkflowServices;
  /** The engine itself: Run Workflow starts a run through it. */
  readonly engine: EngineDeps;
  readonly entry: AnyActionRegistryEntry;
  /** Every repository call is scoped by this (C121.6). */
  readonly environmentId: string;
  readonly environmentKind: 'sandbox' | 'production';
  readonly organizationId: string;
  readonly runId: string;
  readonly rootRunId: string;
  readonly parentRunId: string | null;
  readonly depth: number;
  readonly triggerDepth: number;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly stepId: string;
  readonly nodeId: string;
  readonly iterationPath: string;
  readonly attempt: number;
  /** `<wfr id>/<node id>/<iteration path>`, independent of the attempt (C117.5). */
  readonly effectKey: string;
  /** The run as an actor (C121.1), with the mask its grant allows. */
  readonly acting: Acting;
  readonly grant: RunGrant;
  /**
   * The step's config. Rendered as JSON values, except for an `egress` action, which gets it as
   * written and renders each member for its own sink with {@link scope}, last, after every other
   * check (C115.2, C125.5).
   */
  readonly config: JsonRecord;
  /** The roots a path reads here (C114.4). */
  readonly scope: EvaluationScope;
  /** The graph and what happened so far, for the path a decision record reads (C128.1, C128.2). */
  readonly definition: WorkflowDefinition;
  readonly step: WorkflowStep;
  readonly state: RunState;
  readonly testRun: ActionTestRun | null;
  /** Aborts when the claim is lost: a cancel, a reclaim (C120.5). */
  readonly signal: AbortSignal;
  readonly now: Date;
}

/** What a handler leaves for after the commit, whichever way it ended. */
export interface ActionFollowUp {
  /** Events it staged in the transaction, dispatched after the commit. */
  readonly staged?: readonly StagedEvent[];
  /** Storage deletes and the like: best effort, after the commit. */
  readonly afterCommit?: () => Promise<void>;
}

/** C120.9: ids the step read, wrote, or put in its output. */
export interface ActionSubjects {
  readonly subjects?: readonly WorkflowRunSubject[];
  /** C120.7, C123.4: a sandbox test run's capture, sealed on the step for its creator alone. */
  readonly console?: readonly string[];
}

export type ActionResult =
  | (ActionFollowUp &
      ActionSubjects & {
        readonly kind: 'succeeded';
        /** Parsed by the registry's output schema before it is journaled (C115.5). */
        readonly output: JsonRecord;
        /** C120.9 (P20): a PII-to-PII copy the effect row records. */
        readonly copy?: WorkflowEffectCopy;
      })
  | (ActionFollowUp &
      ActionSubjects & {
        readonly kind: 'failed';
        readonly code: string;
        /** C117.6: only with a `retry` on the step, or a default on the entry. */
        readonly retryable?: boolean;
        /** C117.6: honoured up to the next interval. */
        readonly retryAfterSeconds?: number;
        /** Sealed on the step: an action's own text (C120.2). */
        readonly output?: JsonRecord;
      })
  | (ActionFollowUp &
      ActionSubjects & {
        /** C127.2, C127.3, C127.5, C119.9: the action made its object, and waits for its events. */
        readonly kind: 'waiting';
        /** The object whose events resolve it (C119.3). */
        readonly correlationKey: string;
        readonly events: readonly string[];
        readonly timeoutSeconds: number;
        /** The step error of a timeout (`report_timed_out`, `wait_timed_out`, ...). */
        readonly timeoutCode: string;
        /** Handed to `resume`; sealed in the run's state. */
        readonly carry: JsonRecord;
      })
  | (ActionFollowUp &
      ActionSubjects & {
        /** C126.5: the outcome is not known. A resume stops here until it is acknowledged. */
        readonly kind: 'unknown';
        readonly output: JsonRecord;
      });

/** What resolved an action's wait. */
export interface ActionResolution {
  readonly eventId: string;
  readonly eventName: string;
  /** The event's payload, a JSON:API document. */
  readonly payload: JsonValue;
  readonly carry: JsonRecord;
}

interface HandlerBase {
  readonly key: string;
  readonly version: number;
  /** C117.4: the action's time limit plus a margin; 60 s when left out. */
  leaseSeconds?(config: JsonRecord): number;
  /**
   * C121.3: called in a transaction when a causing principal lacks the step's scope, so an inquiry
   * can be marked for review. The step then errors `cause_lacks_scope` whatever this does.
   */
  onCauseRefused?(tx: Db, context: ActionContext): Promise<ActionFollowUp>;
}

export interface TransactionActionHandler extends HandlerBase {
  readonly shape: 'transaction';
  execute(tx: Db, context: ActionContext): Promise<ActionResult>;
  /** The wait's event arrived; the same transaction as `execute`. */
  resume?(tx: Db, context: ActionContext, resolution: ActionResolution): Promise<ActionResult>;
}

export interface OutsideActionHandler extends HandlerBase {
  readonly shape: 'outside';
  execute(context: ActionContext): Promise<ActionResult>;
  resume?(context: ActionContext, resolution: ActionResolution): Promise<ActionResult>;
}

export type ActionHandler = TransactionActionHandler | OutsideActionHandler;

/** Thrown inside a `transaction` handler: what it wrote rolls back, and the step takes the code. */
export class ActionStepError extends Error {
  override readonly name = 'ActionStepError';

  constructor(
    readonly code: string,
    readonly options: { retryable?: boolean; retryAfterSeconds?: number } = {},
  ) {
    super(code);
  }
}

/** Read-only: a run can never change what a step does. */
export interface ActionHandlerTable {
  get(key: string, version: number): ActionHandler | undefined;
}

/** @throws {TypeError} for a `key@version` given twice: a bug in code, so it throws at start. */
export function createActionHandlerTable(handlers: readonly ActionHandler[]): ActionHandlerTable {
  const byId = new Map<string, ActionHandler>();
  for (const handler of handlers) {
    const id = `${handler.key}@${String(handler.version)}`;
    if (byId.has(id)) {
      throw new TypeError(`Two handlers for ${id}`);
    }
    byId.set(id, handler);
  }
  return Object.freeze({
    get: (key: string, version: number) => byId.get(`${key}@${String(version)}`),
  });
}

/** What the engine reads of the catalogue, injected so a test can pass its own. */
export interface EngineActions {
  readonly registry: ActionRegistry;
  readonly handlers: ActionHandlerTable;
}
