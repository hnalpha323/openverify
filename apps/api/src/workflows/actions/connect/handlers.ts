/**
 * C243.1 (Phase 11, Workflow 11A, `workflow-connect`): the handlers of `create_share_token`,
 * `redeem_share_token` and `expire_share_token`, over {@link ConnectActionPort}.
 *
 * Each runs in the step's transaction (the `transaction` shape), so its effect row and the service's
 * writes commit together and the step's effect key makes it exactly once (C117.5). The run is the
 * actor (`workflow-run`), so every audit entry the service writes names the workflow. The service is
 * called inside a savepoint: a refusal rolls back whatever it wrote, and the step fails with the
 * problem's code, the code a route would answer (`consent_required`, `connection_not_active`, ...),
 * with `consent_required`'s `reason` and a `share_redeem_meta_conflict`'s pointers in the step's
 * sealed output; the one 404 of an unseen object reads `object_not_found`, as every object action's
 * does. While the install keeps Connect off (C231.10) every step answers that 404 and calls nothing.
 *
 * A redemption is accepted here (the token `pending`, C234.1's synchronous part, its destination
 * consent record checked by the service: C243.4) and its `connect-redeem` job is enqueued after the
 * commit, never before and never for a refused step. Without the producer the step fails closed with
 * `provider_not_configured` before anything is written.
 */
import {
  CONNECT_PROBLEM_CODES,
  createShareTokenBodySchema,
  isId,
  redeemShareTokenBodySchema,
  shareRedeemMetaConflicts,
  shareRedeemModeOf,
  type CreateShareTokenBody,
  type RedeemShareTokenBody,
} from '@openverify/contracts';
import type { Db } from '@openverify/db';
import type { JsonRecord } from '@openverify/workflow-engine';
import {
  createShareTokenConfigSchema,
  expireShareTokenConfigSchema,
  redeemShareTokenConfigSchema,
  type RedeemShareTokenConfig,
} from '@openverify/workflow-engine/actions';
import { AppError, NotImplementedError } from '../../../errors.js';
import { connectNotFound } from '../../../services/connect/not-found.js';
import { connectEnabled } from '../../../services/connect/switch.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionHandler,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { apiDepsOf, configOf, stepErrorOf } from '../shared.js';
import { enqueueRedemption } from '../../../services/connect/redeem.js';
import type { ConnectActionAnswer, ConnectActionCaller, ConnectActionPort } from './port.js';

type Failed = Extract<ActionResult, { kind: 'failed' }>;

const CONNECT_CODES: ReadonlySet<string> = new Set(CONNECT_PROBLEM_CODES);

const invalid = (): never => {
  throw new ActionStepError('action_input_invalid');
};

/** The caller of the service: the run, in its environment, at the step's time. */
const callerOf = (context: ActionContext): ConnectActionCaller => ({
  deps: apiDepsOf(context),
  acting: context.acting,
  now: context.now,
});

/** A Connect problem's sealed output: its code, `reason` and pointers, never a value. */
function problemOutput(error: AppError, code: string): JsonRecord {
  const pointers = (error.errors ?? []).map(({ pointer }) => pointer);
  return {
    code,
    ...(error.reason === undefined ? {} : { reason: error.reason }),
    ...(pointers.length === 0 ? {} : { pointers }),
  };
}

/** A service's refusal as the step's answer; anything else stays a bug. */
function refusalOf(error: unknown): Failed {
  if (error instanceof NotImplementedError) {
    return { kind: 'failed', code: 'not_implemented' };
  }
  if (error instanceof AppError && error.code !== undefined && CONNECT_CODES.has(error.code)) {
    return { kind: 'failed', code: error.code, output: problemOutput(error, error.code) };
  }
  const refusal = stepErrorOf(error);
  if (refusal === null) {
    throw error;
  }
  return { kind: 'failed', code: refusal.code, ...refusal.options };
}

/**
 * C231.10: while the install keeps Connect off, the one 404, before the step's config is read, as
 * the routes' switch runs before their body; `null` while it is on.
 */
const switchedOff = (context: ActionContext): Failed | null =>
  connectEnabled(apiDepsOf(context).connect) ? null : refusalOf(connectNotFound());

/**
 * The service in a savepoint of the step's transaction: its answer, or the step's failure with
 * nothing it wrote kept.
 */
async function calling(
  tx: Db,
  context: ActionContext,
  work: (savepoint: Db, caller: ConnectActionCaller) => Promise<ConnectActionAnswer>,
): Promise<ConnectActionAnswer | Failed> {
  const caller = callerOf(context);
  try {
    return await tx.transaction((savepoint) => work(savepoint, caller));
  } catch (error) {
    return refusalOf(error);
  }
}

const isFailed = (answer: ConnectActionAnswer | Failed): answer is Failed => 'kind' in answer;

/** A `{{...}}` lifetime renders as a number or as its digits. */
function secondsOf(value: unknown): number | undefined {
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  return typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : invalid();
}

function createBodyOf(context: ActionContext): CreateShareTokenBody {
  const config = configOf(context, createShareTokenConfigSchema);
  const seconds = secondsOf(config['expires-in-seconds']);
  const parsed = createShareTokenBodySchema.safeParse({
    data: {
      type: 'connect/share-token',
      attributes: {
        'connection-id': config['connection-id'],
        'source-id': config['source-id'],
        'consent-record-id': config['consent-record-id'],
        ...(seconds === undefined ? {} : { 'expires-in-seconds': seconds }),
      },
    },
  });
  return parsed.success ? parsed.data : invalid();
}

/** The share token a step names, as an id of its kind. */
function tokenIdOf(id: string): string {
  return isId('cnst', id) ? id : invalid();
}

/** C234.1: the redeem body, `destination-id` back under `data.attributes`, no mode of its own. */
function redeemBodyOf(config: RedeemShareTokenConfig): RedeemShareTokenBody {
  const meta = Object.fromEntries(
    Object.entries(config.meta).filter(([, value]) => value !== undefined),
  );
  const destination = config['destination-id'];
  const parsed = redeemShareTokenBodySchema.safeParse({
    ...(destination === undefined
      ? {}
      : { data: { attributes: { 'destination-id': destination } } }),
    meta,
  });
  return parsed.success ? parsed.data : invalid();
}

const tokenSubjects = (id: string, read: readonly string[] = []) => [
  { subjectId: id, source: 'written' as const },
  ...read.map((subjectId) => ({ subjectId, source: 'read' as const })),
];

const CREATE_SHARE_TOKEN_HANDLER = (port: ConnectActionPort): TransactionActionHandler => ({
  key: 'create_share_token',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const off = switchedOff(context);
    if (off !== null) {
      return off;
    }
    const body = createBodyOf(context);
    const answer = await calling(tx, context, (savepoint, caller) =>
      port.createShareToken(savepoint, caller, body),
    );
    if (isFailed(answer)) {
      return answer;
    }
    const { token } = answer;
    return {
      kind: 'succeeded',
      output: {
        'share-token-id': token.id,
        status: token.attributes.status,
        'expires-at': token.attributes['expires-at'],
      },
      staged: answer.staged ?? [],
      subjects: tokenSubjects(token.id, [body.data.attributes['source-id']]),
    };
  },
});

const REDEEM_SHARE_TOKEN_HANDLER = (port: ConnectActionPort): TransactionActionHandler => ({
  key: 'redeem_share_token',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const off = switchedOff(context);
    if (off !== null) {
      return off;
    }
    const config = configOf(context, redeemShareTokenConfigSchema);
    const shareTokenId = tokenIdOf(config['share-token-id']);
    const body = redeemBodyOf(config);
    const conflicts = shareRedeemMetaConflicts(body);
    if (conflicts.length > 0) {
      const code = 'share_redeem_meta_conflict';
      return { kind: 'failed', code, output: { code, pointers: conflicts } };
    }
    const producer = apiDepsOf(context).connectRedeems;
    if (producer === undefined) {
      return { kind: 'failed', code: 'provider_not_configured' };
    }
    const answer = await calling(tx, context, (savepoint, caller) =>
      port.redeemShareToken(savepoint, caller, shareTokenId, body),
    );
    if (isFailed(answer)) {
      return answer;
    }
    const { token } = answer;
    const { environmentId } = context;
    return {
      kind: 'succeeded',
      output: {
        'share-token-id': token.id,
        status: token.attributes.status,
        'redeem-mode': shareRedeemModeOf(body),
      },
      staged: answer.staged ?? [],
      subjects: tokenSubjects(token.id),
      // KP11-12 (integration-11b): admitted under the destination's cap, as every redemption is, on
      // the engine's own database and clock (every engine has both; a step's services need not).
      afterCommit: () =>
        enqueueRedemption(
          { ...apiDepsOf(context), db: context.engine.db, clock: context.engine.clock },
          { environmentId, shareTokenId: token.id },
        ),
    };
  },
});

const EXPIRE_SHARE_TOKEN_HANDLER = (port: ConnectActionPort): TransactionActionHandler => ({
  key: 'expire_share_token',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const off = switchedOff(context);
    if (off !== null) {
      return off;
    }
    const config = configOf(context, expireShareTokenConfigSchema);
    const shareTokenId = tokenIdOf(config['share-token-id']);
    const answer = await calling(tx, context, (savepoint, caller) =>
      port.expireShareToken(savepoint, caller, shareTokenId),
    );
    if (isFailed(answer)) {
      return answer;
    }
    const { token } = answer;
    return {
      kind: 'succeeded',
      output: {
        'share-token-id': token.id,
        status: token.attributes.status,
        'expiry-reason': token.attributes['expiry-reason'],
      },
      staged: answer.staged ?? [],
      subjects: tokenSubjects(token.id),
    };
  },
});

/** The three handlers over `port`. */
export function createConnectActionHandlers(port: ConnectActionPort): readonly ActionHandler[] {
  return Object.freeze([
    CREATE_SHARE_TOKEN_HANDLER(port),
    REDEEM_SHARE_TOKEN_HANDLER(port),
    EXPIRE_SHARE_TOKEN_HANDLER(port),
  ]);
}
