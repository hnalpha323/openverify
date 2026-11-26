/**
 * `flow-renderer`'s test support (Workflow 9A): sessions at a server position (C151.5), built on
 * `flowSession` and parsed with the contract schema, so tests never run against data the real API
 * could not send; and the fake flow API's `flow-renderer` members (`registerFakeFlowExtension`,
 * review F11): the screen submission and the selfie-capture extension, driven by a script the test
 * sets, so branches come from the "server's" answers and nothing is evaluated on the client.
 */
import {
  flowSessionResponseSchema,
  selfieCaptureDocumentSchema,
  type FlowSessionResponse,
  type SelfieCaptureResource,
  type SubmitFlowScreenBody,
} from '@openverify/contracts';
import type { ClientStepView } from '@openverify/flow-spec';
import { vi } from 'vitest';
import type { FlowApiClient } from '../api/flow-api-client';
import type { FakeFlowApi } from './fake-flow-api';
import { registerFakeFlowExtension } from './fake-flow-registry';
import {
  AT_ISO,
  INQUIRY_ID,
  VERIFICATION_IDS,
  flowSession,
  type FlowSessionOptions,
} from './flow-fixtures';

/** The members a Phase 9 server adds at a position (C151.5), as a test serves them. */
export interface ServedPosition {
  readonly position: NonNullable<FlowSessionResponse['position']>;
  readonly step?: ClientStepView;
  readonly values?: FlowSessionResponse['values'];
  readonly copy?: FlowSessionResponse['copy'];
  readonly locales?: FlowSessionResponse['locales'];
  readonly completion?: FlowSessionResponse['completion'];
  readonly 'decision-contest-route'?: FlowSessionResponse['decision-contest-route'];
  /** C162.3 (Workflow 9B): the version's help and privacy links. */
  readonly links?: FlowSessionResponse['links'];
}

/** A position on `stepId`, active unless `state` says otherwise. */
export function at(
  stepId: string | null,
  state: NonNullable<FlowSessionResponse['position']>['state'] = 'active',
  previous: string | null = null,
): NonNullable<FlowSessionResponse['position']> {
  return { 'step-id': stepId, state, 'previous-step-id': previous };
}

/** A session at a server position, its members laid over `flowSession(options)`. */
export function positionedSession(
  served: ServedPosition,
  options: FlowSessionOptions = {},
): FlowSessionResponse {
  return flowSessionResponseSchema.parse({
    ...flowSession(options),
    'spec-version': 2,
    ...served,
  });
}

/** The script of a fake: what the "server" serves now, and what a submission leads to. */
export interface RendererScript {
  served: ServedPosition | null;
  onSubmit: ((stepId: string, body: SubmitFlowScreenBody) => ServedPosition) | null;
  /** The capture of each extension, in order. */
  readonly extensions: string[];
  /** Each extension's new `expires-at`. */
  extendBy: number;
}

const SCRIPTS = new WeakMap<FakeFlowApi, RendererScript>();

export function rendererScript(fake: FakeFlowApi): RendererScript {
  let script = SCRIPTS.get(fake);
  if (script === undefined) {
    script = { served: null, onSubmit: null, extensions: [], extendBy: 180_000 };
    SCRIPTS.set(fake, script);
  }
  return script;
}

/** Serves `served` from the fake's next session answer on. */
export function serve(fake: FakeFlowApi, served: ServedPosition | null): void {
  rendererScript(fake).served = served;
}

/** The extended capture as `POST /flow/selfie-captures/:id/extend` answers it (C171.4). */
export function extendedCapture(id: string, expiresAt: string): SelfieCaptureResource {
  return selfieCaptureDocumentSchema.parse({
    data: {
      type: 'selfie',
      id,
      attributes: {
        status: 'initiated',
        'capture-method': 'camera',
        liveness: 'passive',
        prompts: ['center'],
        'prompt-timings': [],
        'created-at': AT_ISO,
        'expires-at': expiresAt,
        'submitted-at': null,
        'processed-at': null,
        'error-code': null,
      },
      relationships: {
        verification: { data: { type: 'verification/selfie', id: VERIFICATION_IDS.selfie } },
        inquiry: { data: { type: 'inquiry', id: INQUIRY_ID } },
      },
    },
  }).data;
}

registerFakeFlowExtension('flow-renderer', {
  session: (session, fake) => {
    const { served } = rendererScript(fake);
    return served === null
      ? session
      : flowSessionResponseSchema.parse({ ...session, 'spec-version': 2, ...served });
  },
  client: (fake) => ({
    submitScreen: vi.fn<FlowApiClient['submitScreen']>((stepId, body) => {
      const script = rendererScript(fake);
      if (script.onSubmit !== null) {
        script.served = script.onSubmit(stepId, body);
      }
      return fake.client.getSession();
    }),
    extendSelfieCapture: vi.fn<FlowApiClient['extendSelfieCapture']>((captureId) => {
      const script = rendererScript(fake);
      script.extensions.push(captureId);
      const expiresAt = new Date(
        Date.parse(AT_ISO) + script.extendBy * (script.extensions.length + 1),
      ).toISOString();
      return Promise.resolve(extendedCapture(captureId, expiresAt));
    }),
    // C160.6 (Workflow 9B): a theme asset, a few bytes of PNG header.
    getThemeAsset: vi.fn<FlowApiClient['getThemeAsset']>(() =>
      Promise.resolve({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).buffer,
        mediaType: 'image/png',
      }),
    ),
  }),
});

/**
 * C161.3: a text matcher for a message whose interpolated values sit in their own `<bdi>`, so the
 * text is split across elements: the element whose whole text is `text`, and none of its children.
 */
export function wholeText(text: string | RegExp) {
  const matches = (content: string | null) =>
    content !== null && (typeof text === 'string' ? content === text : text.test(content));
  return (_content: string, element: Element | null): boolean =>
    element !== null &&
    matches(element.textContent) &&
    !Array.from(element.children).some((child) => matches(child.textContent));
}
