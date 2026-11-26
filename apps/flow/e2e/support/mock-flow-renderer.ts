/**
 * `flow-renderer`'s answers in the mocked suite (Workflow 9A; registered through
 * `registerMockFlowExtension`, review F11): the server's position and the current step's client
 * view (C151.5), screen submissions (C148.5) and the selfie-capture extension (C171.4). A spec
 * scripts the "server": what the session serves now (`serve`) and what a screen submission leads to
 * (`script.onSubmit`), so branches are driven by mocked session answers and nothing is evaluated
 * here or in the flow.
 */
import type { MockFlowApi } from './mock-flow-api';
import { INQUIRY_ID, registerMockFlowExtension } from './mock-flow-api';

/** The members a Phase 9 session adds at a position (C151.5), as a spec serves them. */
export interface ServedPosition {
  readonly position: {
    readonly 'step-id': string | null;
    readonly state: 'active' | 'waiting' | 'halted' | 'ended';
    readonly 'previous-step-id': string | null;
    readonly 'retry-after-ms'?: number;
  };
  readonly step?: Readonly<Record<string, unknown>>;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly copy?: { readonly messages: Readonly<Record<string, Readonly<Record<string, string>>>> };
  readonly locales?: { readonly enabled: readonly string[]; readonly default: string };
  readonly completion?: { readonly 'redirect-url': string | null };
  readonly 'decision-contest-route'?: {
    readonly url: string | null;
    readonly host: string | null;
    readonly contact: string | null;
  };
  /** The inquiry status the mock moves to when this is served (`completed`, `failed`, ...). */
  readonly inquiryStatus?: string;
}

/** A screen submission as the mock received it. */
export interface ScreenSubmissionRecord {
  readonly stepId: string;
  readonly body: { readonly values: Readonly<Record<string, unknown>>; readonly button?: string };
}

export class RendererScript {
  /** What the session serves now; `null` serves the mock's own session unchanged. */
  served: ServedPosition | null = null;
  /** What a submission of the current screen leads to; absent, the screen is served again. */
  onSubmit: ((submission: ScreenSubmissionRecord) => ServedPosition) | null = null;
  readonly submissions: ScreenSubmissionRecord[] = [];
  /** The `OpenVerify-Flow-Spec` header of each session read (C151.7). */
  readonly declaredSpecs: (string | null)[] = [];
  /** The capture of each extension (C171.4), in order. */
  readonly extensions: string[] = [];
}

const SCRIPTS = new WeakMap<MockFlowApi, RendererScript>();

/** The script of `mock`, made on first use. */
export function rendererScript(mock: MockFlowApi): RendererScript {
  let script = SCRIPTS.get(mock);
  if (script === undefined) {
    script = new RendererScript();
    SCRIPTS.set(mock, script);
  }
  return script;
}

/** Serves `served` from now on, and moves the mock's inquiry status with it. */
export function serve(mock: MockFlowApi, served: ServedPosition | null): void {
  rendererScript(mock).served = served;
  if (served?.inquiryStatus !== undefined) {
    mock.inquiryStatus = served.inquiryStatus;
  }
}

/** A position on `stepId`. */
export function at(
  stepId: string | null,
  state: ServedPosition['position']['state'] = 'active',
  previous: string | null = null,
): ServedPosition['position'] {
  return { 'step-id': stepId, state, 'previous-step-id': previous };
}

function members(served: ServedPosition): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...served };
  delete rest.inquiryStatus;
  return { ...rest, 'spec-version': 2 };
}

const AT = '2026-10-20T12:00:00.000Z';
const CAPTURE_TTL_MS = 180_000;
const SCREEN_SUBMIT = /^\/screens\/([a-z][a-z0-9_-]{0,63})\/submit$/u;
const EXTEND = /^\/selfie-captures\/(self_[0-9A-Z]{26})\/extend$/u;

registerMockFlowExtension('flow-renderer', {
  session: (session, mock) => {
    const { served } = rendererScript(mock);
    return served === null ? session : { ...session, ...members(served) };
  },
  route: async ({ mock, request, method, path, reply, problem }) => {
    const script = rendererScript(mock);
    if (method === 'GET' && path === '/session') {
      script.declaredSpecs.push((await request.headerValue('openverify-flow-spec')) ?? null);
      return false;
    }
    const screen = SCREEN_SUBMIT.exec(path);
    if (method === 'POST' && screen !== null) {
      const stepId = screen[1] ?? '';
      if (script.served?.position['step-id'] !== stepId) {
        await problem(409, 'Conflict', { code: 'flow_step_not_current' });
        return true;
      }
      const submission = { stepId, body: request.postDataJSON() as ScreenSubmissionRecord['body'] };
      script.submissions.push(submission);
      const next = script.onSubmit?.(submission) ?? script.served;
      serve(mock, next);
      // The session at the next step; the flow reads it again in full.
      await reply(200, {
        inquiry: { id: INQUIRY_ID, status: mock.inquiryStatus },
        flow: mock.flow,
        verifications: [],
        consent: { 'accepted-at': AT },
        ...members(next),
      });
      return true;
    }
    const extend = EXTEND.exec(path);
    if (method === 'POST' && extend !== null) {
      const id = extend[1] ?? '';
      const capture = mock.captures.find((candidate) => candidate.id === id);
      if (capture?.status !== 'initiated') {
        await problem(409, 'Conflict', { code: 'selfie_capture_not_extendable' });
        return true;
      }
      script.extensions.push(id);
      const extensions = script.extensions.filter((one) => one === id).length;
      await reply(200, {
        data: {
          type: 'selfie',
          id,
          attributes: {
            status: 'initiated',
            'capture-method': capture.method,
            liveness: 'passive',
            prompts: capture.prompts,
            'prompt-timings': [],
            'created-at': AT,
            'expires-at': new Date(
              Date.parse(AT) + CAPTURE_TTL_MS * (extensions + 1),
            ).toISOString(),
            'submitted-at': null,
            'processed-at': null,
            'error-code': null,
          },
          relationships: {
            verification: {
              data: { type: 'verification/selfie', id: capture.verificationId },
            },
            inquiry: { data: { type: 'inquiry', id: INQUIRY_ID } },
          },
        },
      });
      return true;
    }
    return false;
  },
});
