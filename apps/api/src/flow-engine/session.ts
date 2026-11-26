/**
 * C151.5-C151.7, C150.5, C151.14 (Workflow 9A, api-flow-engine, checkpoint "session"): the session
 * response's flow members, read from the server's position, the only truth (C151.12):
 *
 * - `position`: the step the person is on, its state, the person-visible step left last (never a
 *   branch or an action, P14), and, while waiting, how soon to poll;
 * - `step`: the current step's client view (`clientViewOf`, an allowlist), only to a client that
 *   declared spec 2 (`OpenVerify-Flow-Spec`); a branch or an action has none, so no route condition,
 *   threshold, signal name or step name reaches a client;
 * - `values` (P16): with the step, the values of the fields bound on that screen, or the field a
 *   verification step prefills from; a `masked_text` value and a write-once value are `{ set: true }`
 *   once set, and no other field leaves the server. A database or AAMVA form step's map is served
 *   by input name (B48, Workflow 9B), as the web flow reads them (`-` read as `_`);
 * - a session that holds no consent of its own (a phone a handoff redeemed after the path passed
 *   its consent step, C94.6) is served that consent step's client view as `step` first, the position
 *   unchanged (B48, Workflow 9B): recording it moves nothing (`current-step.ts`);
 * - `locales`: the version's enabled locales and default;
 * - `links` (C162.3, Workflow 9B): the version's `help-url` and `privacy-url`, each `null` unless it
 *   is an `https:` URL the contract accepts, for every client;
 * - `flow`: the v1 projection (`projection` of `@openverify/flow-spec`, V03) for every client of a
 *   flow-spec 2 version; a version stored as flow-spec 1 keeps serving its own v1 flow, which
 *   today's clients walk (its transitions would be branches, where the projection stops);
 * - `spec-version`: the version served. Negotiation changes only what is sent, never the path.
 *
 * {@link prepareFlowSessionInTx} runs first, under the inquiry's lock: it positions an inquiry the
 * engine never positioned (C151.14), recording the session's device as the first device (C151.1),
 * ends a wait the poll finds over (C150.5, C152.2), as `flow-action-sweep` does, and leaves a
 * `device_handoff` step for a native SDK session (C221.13, Phase 10).
 */
import {
  flowSessionLinksSchema,
  type EnvironmentKind,
  type FlowSessionResponse,
} from '@openverify/contracts';
import {
  getInquirySession,
  listInquiryFlowSteps,
  listInquiryVerifications,
  listVerificationInputSources,
  setInquiryFirstDeviceInTx,
  type Db,
  type Inquiry,
  type InquiryFields,
  type InquiryFlowStep,
  type InquiryTemplateVersion,
} from '@openverify/db';
import {
  clientViewOf,
  deviceKindOf,
  projection,
  type Component,
  type FlowV2,
  type FlowV2Step,
} from '@openverify/flow-spec';
import { settleFlowActionInTx, type FlowActionDeps } from '../flow-actions/run-action.js';
import type { FlowAdvance, FlowInquiryRef } from './advance.js';
import {
  advanceOf,
  currentEntry,
  entriesOf,
  followAction,
  loadEngine,
  resumeBranch,
  skipHandoffForNativeSession,
  type EngineContext,
} from './engine.js';
import { nfcSessionMembers } from '../services/flow-views/nfc.js';
import { storedFlowView } from '../services/stored-flow.js';
import { pinnedFlowOf } from './pinned-flow.js';
import { ensurePosition } from './position.js';
import { stepVerificationOutcome } from './verification-state.js';
import { countedVerifications } from '../services/connect/cloned-results.js';
import {
  shareConsentSessionView,
  withdrawableShareConsents,
} from '../services/flow-views/share-consent.js';

/** C150.5: how often a client polls a waiting position (ours, the plan's 2 s). */
export const FLOW_WAIT_POLL_MS = 2_000;

/** What the session builder knows about the request. */
export interface FlowSessionMembersInput {
  /** The inquiry as read after {@link prepareFlowSessionInTx} committed. */
  inquiry: Inquiry;
  /** The flow-spec versions the client declared (`OpenVerify-Flow-Spec`), `[1]` when none. */
  specVersions: readonly number[];
  /** Whether the session holds a consent (its own, or the inquiry's): the `consent` member. */
  consentRecorded: boolean;
  /**
   * C207.2, C208.2 (Phase 10, Workflow 10C): the session the request authenticated and its
   * environment's kind, which `api-nfc`'s `nfcSessionMembers` needs for an `nfc` step's
   * `prefillMrz` (an SDK client's only) and `sandboxChipAvailable`. Left out by a caller that holds
   * neither; the hook then adds nothing that depends on them.
   */
  sessionId?: string | undefined;
  environmentKind?: EnvironmentKind | undefined;
  /**
   * Workflow 11A Stage 1b (R): the injected clock's time, at which a cloned verification is judged
   * (C235.4: its age at the destination's decision). A caller without a clock (tests) leaves it out,
   * and the inquiry's own `updated_at` stands in.
   */
  now?: Date | undefined;
}

/** The members the engine adds to the session response (C151.5; C162.3's `links`, Workflow 9B). */
export type FlowSessionMembers = Pick<
  FlowSessionResponse,
  | 'position'
  | 'step'
  | 'values'
  | 'locales'
  | 'flow'
  | 'spec-version'
  | 'links'
  | 'withdrawable-share-consents'
>;

type SessionValue = NonNullable<FlowSessionResponse['values']>[string];

/** The field keys a screen binds, in component order (containers and footers walked). */
function screenFields(components: readonly Component[]): { key: string; masked: boolean }[] {
  const fields: { key: string; masked: boolean }[] = [];
  const visit = (component: Component): void => {
    if ('children' in component) {
      component.children.forEach(visit);
      return;
    }
    if ('field' in component && typeof component.field === 'string') {
      fields.push({ key: component.field, masked: component.kind === 'masked_text' });
    }
    if (component.kind === 'address') {
      for (const key of Object.values(component.fields)) {
        if (typeof key === 'string') fields.push({ key, masked: false });
      }
    }
  };
  components.forEach(visit);
  return fields;
}

/** A value the session serves: under `name`, the value of the field `key`. */
interface BoundField {
  /** The key `values` carries the value under. */
  name: string;
  /** The template field whose value it is. */
  key: string;
  masked: boolean;
}

/**
 * The fields a verification step prefills from (C148.7): one key, served under its own key, or
 * (a database or AAMVA form step, B48) a map of inputs to keys, served under each input's name as
 * the web flow reads it: a database input as named (`name_first`), an AAMVA input with `-` read as
 * `_` (`name-first` is `name_first`), so an input whose name differs from its field key is filled.
 */
function prefillFields(step: FlowV2Step): BoundField[] {
  const prefill = (step as { prefillFrom?: unknown }).prefillFrom;
  if (typeof prefill === 'string') return [{ name: prefill, key: prefill, masked: false }];
  if (typeof prefill === 'object' && prefill !== null) {
    return Object.entries(prefill).flatMap(([input, key]) =>
      typeof key === 'string' ? [{ name: input.replaceAll('-', '_'), key, masked: false }] : [],
    );
  }
  return [];
}

/** A stored value as the session may carry it; anything else reads as set, never as itself. */
function sessionValue(value: unknown): SessionValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { set: true };
  if (Array.isArray(value) && value.every((member) => typeof member === 'string')) return value;
  return { set: true };
}

/** The write-once keys of the version's `field-schemas` (C149.5). */
function writeOnceKeys(fieldSchemas: readonly unknown[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const field of fieldSchemas) {
    const { key, 'write-once': writeOnce } = (field ?? {}) as {
      key?: unknown;
      'write-once'?: unknown;
    };
    if (typeof key === 'string' && writeOnce === true) keys.add(key);
  }
  return keys;
}

/** C151.5 (P16): the values the current step shows, and nothing else. */
function valuesOf(
  step: FlowV2Step,
  fields: InquiryFields,
  writeOnce: ReadonlySet<string>,
): Record<string, SessionValue> | null {
  const bound: BoundField[] =
    step.type === 'screen'
      ? screenFields(step.components).map(({ key, masked }) => ({ name: key, key, masked }))
      : prefillFields(step);
  if (bound.length === 0) {
    return null;
  }
  const values: Record<string, SessionValue> = {};
  for (const { name, key, masked } of bound) {
    const value = sessionValue((fields as Record<string, unknown>)[key]);
    values[name] = value !== null && (masked || writeOnce.has(key)) ? { set: true } : value;
  }
  return values;
}

/**
 * C162.3 (Workflow 9B; amendment 47, B43): the version's link fields, each served only when the
 * session contract accepts it (an `https:` URL of at most 2,048 characters), else `null`, so a
 * stored value written around the version contract never reaches a client (fail closed).
 */
function linksOf(version: InquiryTemplateVersion): NonNullable<FlowSessionResponse['links']> {
  const link = (url: string | null, member: 'help-url' | 'privacy-url'): string | null =>
    url === null ? null : (flowSessionLinksSchema.shape[member].safeParse(url).data ?? null);
  return {
    'help-url': link(version.helpUrl, 'help-url'),
    'privacy-url': link(version.privacyUrl, 'privacy-url'),
  };
}

/**
 * C94.6 (Workflow 9B; amendment 23, B48): the consent step a session without consent of its own is
 * shown first: the first of the flow's consent steps (the one `recordConsent` checks the texts of)
 * the path has left, while the position is active elsewhere. `undefined` otherwise.
 */
function passedConsentStep(
  flow: FlowV2,
  inquiry: Inquiry,
  record: readonly InquiryFlowStep[],
): FlowV2Step | undefined {
  if (inquiry.flowState !== 'active') {
    return undefined;
  }
  const passed = new Set(
    record.flatMap((entry) =>
      entry.stepType === 'consent' && entry.exitPort !== null ? [entry.stepId] : [],
    ),
  );
  const step = flow.steps.find((candidate) => candidate.type === 'consent');
  return step !== undefined && step.id !== inquiry.flowStepId && passed.has(step.id)
    ? step
    : undefined;
}

/** C162.9 (V11): whether the version's copy replaces a text of one of the flow's consent steps. */
function usesCustomConsentCopy(flow: FlowV2, copy: unknown): boolean {
  const messages: unknown = (copy as { messages?: unknown } | null)?.messages;
  if (typeof messages !== 'object' || messages === null) {
    return false;
  }
  const keys = new Set(
    flow.steps.flatMap((step) =>
      step.type === 'consent' ? [...step.textKeys, ...(step.optionalTextKeys ?? [])] : [],
    ),
  );
  return Object.values(messages).some(
    (texts: unknown) =>
      typeof texts === 'object' &&
      texts !== null &&
      Object.keys(texts).some((key) => keys.has(key)),
  );
}

/** The session's flow members; `null` for an inquiry the engine never positioned. */
export async function flowSessionMembers(
  db: Db,
  input: FlowSessionMembersInput,
): Promise<FlowSessionMembers | null> {
  const { inquiry } = input;
  if (inquiry.flowStepId === null || inquiry.flowState === null) {
    return null;
  }
  const pinned = await pinnedFlowOf(db, inquiry);
  if (pinned === null) {
    return null;
  }
  const { flow, version } = pinned;
  const record = await listInquiryFlowSteps(db, inquiry.environmentId, inquiry.id);
  // C235.4, C235.7 (Workflow 11A Stage 1b (R), `foundation-11a`'s hook): as the engine reads them.
  const verifications = await countedVerifications(
    db,
    inquiry,
    await listInquiryVerifications(db, inquiry.environmentId, inquiry.id),
    input.now ?? inquiry.updatedAt,
  );
  const sources = await listVerificationInputSources(
    db,
    inquiry.environmentId,
    verifications.filter((verification) => verification.type === 'aamva').map(({ id }) => id),
  );
  const verificationStatuses: Record<string, string> = {};
  for (const step of flow.steps) {
    const outcome = stepVerificationOutcome(step, verifications, sources);
    if (outcome !== null && outcome.status !== 'pending') {
      verificationStatuses[step.id] = outcome.status;
    }
  }
  const served = input.specVersions.includes(2) ? 2 : 1;
  const consentFirst = input.consentRecorded ? undefined : passedConsentStep(flow, inquiry, record);
  const current = consentFirst ?? flow.steps.find((step) => step.id === inquiry.flowStepId);
  const built = served === 2 && current !== undefined ? clientViewOf(current, flow) : null;
  // C207.2, C208.2, C221.1 (Workflow 10C, contracts-10c's hook): an `nfc` view's members that need
  // the inquiry and the environment are `api-nfc`'s (`services/flow-views/nfc.ts`).
  const view =
    built?.type === 'nfc'
      ? {
          ...built,
          ...(await nfcSessionMembers(db, {
            inquiry,
            step: built,
            sessionId: input.sessionId ?? null,
            environmentKind: input.environmentKind ?? null,
            verifications,
          })),
        }
      : // C238.3 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): the `share_consent` view is
        // composed by the server (`clientViewOf` answers `null` for it), `api-consent`'s.
        (built ??
        (served === 2 && current?.type === 'share_consent'
          ? await shareConsentSessionView(db, {
              inquiry,
              step: current,
              sessionId: input.sessionId ?? null,
              environmentKind: input.environmentKind ?? null,
              now: input.now ?? inquiry.updatedAt,
            })
          : null));
  // C237.6 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): this session's withdrawable share
  // consents, `api-consent`'s; left out while there are none.
  const withdrawable = await withdrawableShareConsents(db, {
    inquiry,
    sessionId: input.sessionId ?? null,
  });
  const values =
    view === null || current === undefined
      ? null
      : valuesOf(current, inquiry.fields, writeOnceKeys(version.fieldSchemas));
  return {
    position: {
      'step-id': inquiry.flowStepId,
      state: inquiry.flowState,
      'previous-step-id': inquiry.flowPreviousStepId,
      ...(inquiry.flowState === 'waiting' ? { 'retry-after-ms': FLOW_WAIT_POLL_MS } : {}),
    },
    ...(view === null ? {} : { step: view }),
    ...(values === null ? {} : { values }),
    locales: { enabled: [...version.enabledLocales], default: version.defaultLocale },
    links: linksOf(version),
    // A version stored as flow-spec 1 keeps its own v1 flow: today's clients walk it as in Phases
    // 1-8 (its transitions are migrated into branches, which the projection would stop at), and
    // the position only lets them act on the step the server names (C151.4).
    flow:
      pinned.specVersion === 1
        ? storedFlowView(version.flow)
        : projection(flow, {
            current: inquiry.flowStepId,
            exited: record.flatMap((entry) =>
              entry.exitPort === null ? [] : [{ stepId: entry.stepId, port: entry.exitPort }],
            ),
            verificationStatuses,
            consentRecorded: input.consentRecorded,
            customConsentCopy: usesCustomConsentCopy(flow, version.copy),
          }),
    'spec-version': served,
    ...(withdrawable.length === 0 ? {} : { 'withdrawable-share-consents': withdrawable }),
  };
}

/** C151.1 (F14, H05): the session that served the first step names the first device, once. */
async function recordFirstDevice(ctx: EngineContext, sessionId: string): Promise<void> {
  const session = await getInquirySession(ctx.tx, ctx.ref.environmentId, sessionId);
  if (session === null) {
    return;
  }
  const deviceKind = deviceKindOf({
    deviceType: session.deviceType ?? null,
    mobileSdkName: session.mobileSdkName ?? null,
  });
  const platform =
    session.mobileSdkName === 'openverify-android'
      ? 'android'
      : session.mobileSdkName == null
        ? 'web'
        : null;
  await setInquiryFirstDeviceInTx(ctx.tx, ctx.ref.environmentId, ctx.ref.inquiryId, {
    deviceKind,
    platform,
  });
}

/**
 * C150.5, C152.2: the session poll ends a wait that is over: a branch past its `waitFor` deadline
 * is resumed with its facts as they are (still `null` ones follow `onNull`), and a `run_workflow`
 * step whose run ended moves on, as `flow-action-sweep` does.
 */
async function pollWait(ctx: EngineContext): Promise<void> {
  const entry = currentEntry(ctx);
  const step = entry === null ? undefined : ctx.steps.get(entry.stepId);
  if (entry === null || step === undefined) {
    return;
  }
  if (step.type === 'branch') {
    const deadline = entry.enteredAt.getTime() + (step.waitFor?.maxSeconds ?? 0) * 1_000;
    if (ctx.now.getTime() >= deadline) {
      await resumeBranch(ctx, entry, true);
    }
    return;
  }
  if (step.type === 'action') {
    const outcome = await settleFlowActionInTx(ctx.tx, ctx.deps, ctx.ref, {
      stepId: step.id,
      entry: entriesOf(ctx, step.id),
      action: step.action,
    });
    await followAction(ctx, entry, step, outcome);
  }
}

/**
 * Before a session is answered, under the inquiry's lock: positions an unpositioned inquiry, with
 * the session's device as the first device, ends a wait the poll finds over, and moves a native
 * SDK session past a `device_handoff` step (C221.13).
 */
export async function prepareFlowSessionInTx(
  tx: Db,
  deps: FlowActionDeps,
  ref: FlowInquiryRef,
  sessionId: string,
): Promise<FlowAdvance> {
  const ctx = await loadEngine(tx, deps, ref);
  if (ctx === null) {
    return { staged: [], after: [] };
  }
  if (await ensurePosition(ctx)) {
    await recordFirstDevice(ctx, sessionId);
  } else if (ctx.inquiry.flowState === 'waiting' && ctx.inquiry.redactedAt === null) {
    await pollWait(ctx);
  }
  // C221.13 (Phase 10): a native SDK session is never served a device_handoff step.
  await skipHandoffForNativeSession(ctx, sessionId);
  return advanceOf(ctx);
}
