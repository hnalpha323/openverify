/**
 * C96 (Workflow 7A, `flow-handoff`): what every handoff service reads about a flow's
 * `device_handoff` steps and their tokens.
 *
 * - **The current step.** A flow may hold more than one handoff step; the one the issuing session
 *   works on is the first, in list order, that is not done (C96.3: `redeemed`, `continued_here`
 *   and `skipped` are done), else the one whose state moved last. Its state is kept per inquiry and
 *   step (V05), `pending` before any.
 * - **Mobile sessions skip it** (C96.1, F01): a session with `mobile-sdk-name` always, and with
 *   `skipOnMobile` (the default) one whose parsed `device-type` is `smartphone` or `tablet`. The
 *   skip is the session's view: it is not stored, so a desktop that resumes still sees the step.
 * - **Codes** (C96.5): six digits, kept only as SHA-256 over the token and the code; compared in
 *   constant time, like the token's digest.
 * - **The context screen** (C96.3, F30): the organisation's display name, the step types after the
 *   handoff step, when the issuing session started, and its country with the attribution of the
 *   source that placed it, when network data is configured.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { isHandoffDone, type HandoffContext, type HandoffState } from '@openverify/contracts';
import {
  getOrganization,
  getInquirySession,
  listSessionNetworks,
  type Db,
  type Environment,
  type InquiryHandoffStep,
  type InquirySession,
} from '@openverify/db';
import { DEVICE_HANDOFF_DEFAULTS, type Flow, type FlowStep } from '@openverify/flow-spec';
import { networkManifestSource } from '../../network/manifest.js';

export type HandoffFlowStep = Extract<FlowStep, { type: 'device_handoff' }>;

/** C96.5: wrong codes before the token is revoked. */
export const HANDOFF_CODE_ATTEMPTS = 5;

/** A handoff step's options with the server's defaults applied (C96.1). */
export interface HandoffOptions {
  methods: readonly ('qr' | 'email' | 'sms')[];
  qrTtlSeconds: number;
  linkTtlSeconds: number;
  confirmationCode: boolean;
  skipOnMobile: boolean;
  allowContinueHere: boolean;
}

export function handoffOptionsOf(step: HandoffFlowStep): HandoffOptions {
  return {
    methods: step.methods ?? DEVICE_HANDOFF_DEFAULTS.methods,
    qrTtlSeconds: step.qrTtlSeconds ?? DEVICE_HANDOFF_DEFAULTS.qrTtlSeconds,
    linkTtlSeconds: step.linkTtlSeconds ?? DEVICE_HANDOFF_DEFAULTS.linkTtlSeconds,
    confirmationCode: step.confirmationCode ?? DEVICE_HANDOFF_DEFAULTS.confirmationCode,
    skipOnMobile: step.skipOnMobile ?? DEVICE_HANDOFF_DEFAULTS.skipOnMobile,
    allowContinueHere: step.allowContinueHere ?? DEVICE_HANDOFF_DEFAULTS.allowContinueHere,
  };
}

/** The flow's handoff steps, in list order. */
export function handoffStepsOf(flow: Flow): HandoffFlowStep[] {
  return flow.steps.filter((step): step is HandoffFlowStep => step.type === 'device_handoff');
}

/** A handoff step with its stored state (`pending` before any). */
export interface CurrentHandoffStep {
  step: HandoffFlowStep;
  state: HandoffState;
}

/**
 * The handoff step the issuing session works on: the first not done, else the one whose state
 * moved last; `null` for a flow without one.
 */
export function currentHandoffStep(
  flow: Flow,
  stored: readonly InquiryHandoffStep[],
): CurrentHandoffStep | null {
  const steps = handoffStepsOf(flow).map((step) => {
    const found = stored.find((row) => row.stepId === step.id);
    return { step, state: found?.state ?? 'pending', updatedAt: found?.updatedAt ?? null };
  });
  const waiting = steps.find(({ state }) => !isHandoffDone(state));
  if (waiting !== undefined) {
    return { step: waiting.step, state: waiting.state };
  }
  const [latest] = [...steps].sort(
    (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
  );
  return latest === undefined ? null : { step: latest.step, state: latest.state };
}

type MobileFacts = Pick<InquirySession, 'mobileSdkName' | 'deviceType'>;

/** C96.1 (F01): whether the session skips handoff steps. */
export function skipsHandoff(session: MobileFacts, options: HandoffOptions): boolean {
  if (session.mobileSdkName !== null) {
    return true;
  }
  return (
    options.skipOnMobile && (session.deviceType === 'smartphone' || session.deviceType === 'tablet')
  );
}

/** The state a session is served: the stored one, or `skipped` for a mobile session (F01). */
export function servedHandoffState(
  current: CurrentHandoffStep,
  session: MobileFacts,
): HandoffState {
  if (isHandoffDone(current.state)) {
    return current.state;
  }
  return skipsHandoff(session, handoffOptionsOf(current.step)) ? 'skipped' : current.state;
}

/** SHA-256 hex, as `hashSessionToken` writes every token's digest. */
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** C96.5: the stored form of a confirmation code, bound to its token. */
export function handoffCodeHash(token: string, code: string): string {
  return sha256(`openverify/handoff-code/v1|${token}|${code}`);
}

/** C96.5: six random digits. */
export function newConfirmationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Two lowercase hex digests compared in constant time (C1, C9). */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The step types after the handoff step, to say what will be verified (C96.3). */
export function remainingStepTypes(flow: Flow, stepId: string): HandoffContext['steps'] {
  const index = flow.steps.findIndex((step) => step.id === stepId);
  const types = new Set<HandoffContext['steps'][number]>();
  for (const step of flow.steps.slice(index + 1)) {
    if (!['consent', 'device_handoff', 'completion', 'failure'].includes(step.type)) {
      types.add(step.type);
    }
  }
  return [...types].slice(0, 64);
}

/** The roles of the sources whose country a phone may be shown (C92.8). */
const COUNTRY_ROLES: ReadonlySet<string> = new Set(['geo-country', 'geo-city', 'sandbox']);

/**
 * The issuing session's country and the attribution of the source that placed it, or both `null`
 * when the session was not evaluated, has no country, or no manifest source names its attribution.
 */
async function issuingCountryOf(
  db: Db,
  issuing: InquirySession,
): Promise<{ country: string | null; attribution: string | null }> {
  const none = { country: null, attribution: null };
  if (issuing.countryCode === null) {
    return none;
  }
  const [network] = await listSessionNetworks(db, issuing.environmentId, [issuing.id]);
  for (const source of network?.sources ?? []) {
    const sourceId = source['source-id'];
    if (source.kind !== 'sync' || typeof sourceId !== 'string') {
      continue;
    }
    let attribution: string | undefined;
    try {
      const found = networkManifestSource(sourceId);
      attribution =
        found !== undefined && COUNTRY_ROLES.has(found.role) ? found.attribution : undefined;
    } catch {
      attribution = undefined;
    }
    if (attribution !== undefined) {
      return { country: issuing.countryCode, attribution: attribution.slice(0, 200) };
    }
  }
  return none;
}

/**
 * The organisation's name a phone is shown: the environment's `organization-display-name`, or,
 * should it have been cleared after the step was published, the organisation's own name.
 */
export async function organizationDisplayNameOf(
  db: Db,
  environment: Pick<Environment, 'organizationId' | 'settings'>,
): Promise<string> {
  const configured = environment.settings['organization-display-name'];
  if (typeof configured === 'string' && configured.length > 0) {
    return configured;
  }
  const organization = await getOrganization(db, environment.organizationId);
  return (organization?.name ?? '').slice(0, 100) || 'OpenVerify';
}

/** C96.3 (F30): the context screen of a handoff from `issuingSessionId`. */
export async function handoffContextOf(
  db: Db,
  input: {
    environment: Pick<Environment, 'organizationId' | 'settings'>;
    flow: Flow;
    stepId: string;
    environmentId: string;
    issuingSessionId: string;
  },
): Promise<HandoffContext> {
  const issuing = await getInquirySession(db, input.environmentId, input.issuingSessionId);
  const { country, attribution } =
    issuing === null ? { country: null, attribution: null } : await issuingCountryOf(db, issuing);
  return {
    'organization-display-name': await organizationDisplayNameOf(db, input.environment),
    steps: remainingStepTypes(input.flow, input.stepId),
    'started-at': (issuing?.startedAt ?? issuing?.createdAt ?? new Date(0)).toISOString(),
    'issuing-country-code': country,
    attribution,
  };
}
