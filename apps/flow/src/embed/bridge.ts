/**
 * C159.4 (Workflow 9A, `flow-server-embed`): the embed bridge. On an `/embed/{inquiry id}` page the
 * flow answers the embedding page's `hello` (`parentToFlowMessageSchema`) only when:
 * - it came from `window.parent` (`event.source`), within `FLOW_MESSAGE_MAX_BYTES`;
 * - its `event.origin` matches an entry of the session's `embed.allowed-origins` through
 *   `matchesOriginPattern` (C158.1), the session being the server's truth, read by the embed entry;
 * - the path's inquiry id is the session's `inquiry.id` (C158.3);
 * - `location.ancestorOrigins`, where the browser gives it, does not name another parent (a value of
 *   `"null"`, which `referrerpolicy="no-referrer"` produces, counts as absent; never gated on it).
 *
 * From then on it posts only to that exact origin, and only messages of `flowToParentMessageSchema`:
 * `ready`, `event` (`start`, `step-changed` with the step's type, never its id, `complete`, `error`),
 * `resize`, `complete` (the inquiry id and its status, a hint) and `error` (a public code). No message
 * carries personal data, a token, a step id or a field value. Before the handshake it posts nothing.
 *
 * The call in `main.tsx` was placed by `foundation-9a` (Stage 1b (F)); `EmbedEntry` reports each
 * session and final failure through {@link reportEmbedSession} and {@link reportEmbedError}.
 */
import {
  FLOW_MESSAGE_MAX_BYTES,
  flowToParentMessageSchema,
  matchesOriginPattern,
  parentToFlowMessageSchema,
  type FlowSessionResponse,
  type FlowToParentMessage,
} from '@openverify/contracts';

/** The browser globals the bridge reads (`window` in `main.tsx`; injected in tests). */
export interface EmbedBridgeHost {
  readonly location: Pick<Location, 'pathname'> & {
    readonly ancestorOrigins?: { readonly length: number; item(index: number): string | null };
  };
  readonly parent: unknown;
  readonly document?: Pick<Document, 'documentElement'>;
  addEventListener: Window['addEventListener'];
  removeEventListener: Window['removeEventListener'];
}

/** What the bridge reads of a session the flow received. */
export interface EmbedSessionReport {
  readonly inquiryId: string;
  readonly status: string;
  readonly allowedOrigins: readonly string[];
  /** The current step's id, only to notice a change; never posted. */
  readonly stepId: string | null;
  readonly stepType: string | null;
}

/** C159.5: the codes the bridge posts. */
export type EmbedBridgeErrorCode = 'application_error' | 'unauthenticated' | 'unknown';

/** The statuses after which the person's part is over (the `complete` hint). */
const ENDED_STATUSES = ['completed', 'failed', 'expired', 'needs_review', 'approved', 'declined'];

/** The report of `session`: its inquiry, the origins it allows and its current step. */
export function embedSessionReportOf(session: FlowSessionResponse): EmbedSessionReport {
  const stepId = session.position?.['step-id'] ?? null;
  const steps: readonly { readonly id: string; readonly type: string }[] = session.flow.steps;
  const stepType =
    session.step?.type ??
    (stepId === null ? null : (steps.find((step) => step.id === stepId)?.type ?? null));
  return {
    inquiryId: session.inquiry.id,
    status: session.inquiry.status,
    allowedOrigins: session.embed?.['allowed-origins'] ?? [],
    stepId,
    stepType,
  };
}

interface Bridge {
  readonly host: EmbedBridgeHost;
  readonly pathInquiryId: string;
  session: EmbedSessionReport | null;
  /** The origin of the last hello not answered yet. */
  hello: string | null;
  /** The parent's exact origin, once the handshake passed. */
  parentOrigin: string | null;
  lastStepId: string | null;
  ended: boolean;
  lastHeight: number | null;
  observer: ResizeObserver | null;
}

let active: Bridge | null = null;

interface Poster {
  postMessage(message: unknown, targetOrigin: string): void;
}
const isPoster = (value: unknown): value is Poster =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<Poster>).postMessage === 'function';

/** Posts `message` to the parent's exact origin, after the handshake and only in the frozen shape. */
function post(bridge: Bridge, message: FlowToParentMessage): void {
  const parsed = flowToParentMessageSchema.safeParse(message);
  if (bridge.parentOrigin === null || !parsed.success || !isPoster(bridge.host.parent)) {
    return;
  }
  bridge.host.parent.postMessage(parsed.data, bridge.parentOrigin);
}

const ENVELOPE = { source: 'openverify-flow', version: 1 } as const;

function withinSize(data: unknown): boolean {
  try {
    const json = JSON.stringify(data);
    return new TextEncoder().encode(json).byteLength <= FLOW_MESSAGE_MAX_BYTES;
  } catch {
    return false;
  }
}

/** Whether `ancestorOrigins`, where present and meaningful, names `origin` as the parent. */
function ancestorAgrees(host: EmbedBridgeHost, origin: string): boolean {
  const ancestors = host.location.ancestorOrigins;
  const parent = ancestors === undefined || ancestors.length === 0 ? null : ancestors.item(0);
  return parent === null || parent === 'null' || parent === origin;
}

function allowed(bridge: Bridge, origin: string): boolean {
  const { session } = bridge;
  return (
    session !== null &&
    session.inquiryId === bridge.pathInquiryId &&
    session.allowedOrigins.some((entry) => matchesOriginPattern(origin, entry)) &&
    ancestorAgrees(bridge.host, origin)
  );
}

function postHeight(bridge: Bridge): void {
  const element = bridge.host.document?.documentElement;
  if (element === undefined || bridge.parentOrigin === null) {
    return;
  }
  const height = Math.min(100_000, Math.ceil(element.scrollHeight));
  if (height !== bridge.lastHeight) {
    bridge.lastHeight = height;
    post(bridge, { ...ENVELOPE, type: 'resize', height });
  }
}

function postEnd(bridge: Bridge): void {
  const { session } = bridge;
  if (session === null || bridge.ended || !ENDED_STATUSES.includes(session.status)) {
    return;
  }
  bridge.ended = true;
  post(bridge, { ...ENVELOPE, type: 'event', name: 'complete' });
  post(bridge, {
    ...ENVELOPE,
    type: 'complete',
    'inquiry-id': session.inquiryId,
    status: session.status as 'completed',
  });
}

/** Answers the pending hello when every check passes. */
function connect(bridge: Bridge): void {
  const origin = bridge.hello;
  if (origin === null || !allowed(bridge, origin)) {
    return;
  }
  const first = bridge.parentOrigin === null;
  bridge.parentOrigin = origin;
  bridge.hello = null;
  post(bridge, { ...ENVELOPE, type: 'ready' });
  if (!first) {
    return;
  }
  post(bridge, { ...ENVELOPE, type: 'event', name: 'start' });
  bridge.lastStepId = bridge.session?.stepId ?? null;
  postEnd(bridge);
  const element = bridge.host.document?.documentElement;
  if (element !== undefined && typeof ResizeObserver === 'function') {
    bridge.observer = new ResizeObserver(() => {
      postHeight(bridge);
    });
    bridge.observer.observe(element);
  }
}

/** Tells the mounted bridge about a session the flow received. */
export function reportEmbedSession(report: EmbedSessionReport): void {
  const bridge = active;
  if (bridge === null) {
    return;
  }
  bridge.session = report;
  if (bridge.parentOrigin === null) {
    connect(bridge);
    return;
  }
  if (!allowed(bridge, bridge.parentOrigin)) {
    // The origin left the session's list (or the session is another inquiry's): stop talking.
    bridge.parentOrigin = null;
    return;
  }
  if (report.stepId !== bridge.lastStepId) {
    bridge.lastStepId = report.stepId;
    post(bridge, {
      ...ENVELOPE,
      type: 'event',
      name: 'step-changed',
      ...(report.stepType === null ? {} : { metadata: { 'step-type': report.stepType } }),
    });
  }
  postEnd(bridge);
}

/** Tells the mounted bridge the flow cannot go on. */
export function reportEmbedError(code: EmbedBridgeErrorCode): void {
  const bridge = active;
  if (bridge === null) {
    return;
  }
  post(bridge, { ...ENVELOPE, type: 'event', name: 'error' });
  post(bridge, { ...ENVELOPE, type: 'error', code });
}

/**
 * C159.4, C148.2 (Workflow 9A Stage 4): the person stopped for now through a confirmed cancel
 * button. The parent hears `event cancel` and `cancel` with the session's inquiry (the server's,
 * never the path's), and nothing before the handshake.
 */
export function reportEmbedCancel(): void {
  const bridge = active;
  const inquiryId = bridge?.session?.inquiryId;
  if (bridge === null || inquiryId === undefined) {
    return;
  }
  post(bridge, { ...ENVELOPE, type: 'event', name: 'cancel' });
  post(bridge, { ...ENVELOPE, type: 'cancel', 'inquiry-id': inquiryId });
}

/** Starts the bridge on an `/embed/` page; answers its disposer. Elsewhere it does nothing. */
export function mountEmbedBridge(host: EmbedBridgeHost): () => void {
  const [, entry, inquiryId] = host.location.pathname.split('/');
  if (entry !== 'embed' || inquiryId === undefined || inquiryId === '') {
    return () => undefined;
  }
  const bridge: Bridge = {
    host,
    pathInquiryId: inquiryId,
    session: null,
    hello: null,
    parentOrigin: null,
    lastStepId: null,
    ended: false,
    lastHeight: null,
    observer: null,
  };
  const onMessage = (event: Event): void => {
    const message = event as MessageEvent;
    if (
      host.parent === null ||
      message.source !== host.parent ||
      !withinSize(message.data) ||
      !parentToFlowMessageSchema.safeParse(message.data).success
    ) {
      return;
    }
    bridge.hello = message.origin;
    connect(bridge);
  };
  host.addEventListener('message', onMessage);
  active = bridge;
  return () => {
    host.removeEventListener('message', onMessage);
    bridge.observer?.disconnect();
    bridge.parentOrigin = null;
    if (active === bridge) {
      active = null;
    }
  };
}
