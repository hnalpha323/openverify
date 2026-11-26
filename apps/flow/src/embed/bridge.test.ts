/**
 * C158.3, C159.4 (Workflow 9A, flow-server-embed): the embed bridge answers a `hello` only from
 * `window.parent`, only when its origin matches the session's `embed.allowed-origins` through
 * `matchesOriginPattern` (cross-checked with `location.ancestorOrigins` where present, never gated
 * on it), only when the path's inquiry is the session's, and from then on posts only to that exact
 * origin, messages of the frozen shape with no step id, token or field value. Every origin is a
 * reserved name and every value is synthetic.
 */
import { flowToParentMessageSchema, type FlowSessionResponse } from '@openverify/contracts';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { flowSession, INQUIRY_ID } from '../testing/flow-fixtures';
import {
  embedSessionReportOf,
  mountEmbedBridge,
  reportEmbedCancel,
  reportEmbedError,
  reportEmbedSession,
  type EmbedBridgeHost,
  type EmbedSessionReport,
} from './bridge';

const SHOP = 'https://shop.example.com';
const OTHER_INQUIRY = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const HELLO = { source: 'openverify-parent', version: 1, type: 'hello' };

interface TestHost extends EmbedBridgeHost {
  readonly parent: { postMessage: ReturnType<typeof vi.fn> };
  readonly target: EventTarget;
}

function host(options: { path?: string; ancestorOrigins?: readonly string[] } = {}): TestHost {
  const target = new EventTarget();
  const ancestors = options.ancestorOrigins;
  return {
    target,
    location: {
      pathname: options.path ?? `/embed/${INQUIRY_ID}`,
      ...(ancestors === undefined
        ? {}
        : {
            ancestorOrigins: {
              length: ancestors.length,
              item: (index: number) => ancestors[index] ?? null,
            },
          }),
    },
    parent: { postMessage: vi.fn() },
    addEventListener: target.addEventListener.bind(target) as Window['addEventListener'],
    removeEventListener: target.removeEventListener.bind(target) as Window['removeEventListener'],
  };
}

/** A message as the browser delivers it (`origin` and `source` set by the browser). */
function deliver(on: TestHost, data: unknown, origin: string, source: unknown = on.parent): void {
  const event = new Event('message');
  Object.defineProperties(event, {
    data: { value: data },
    origin: { value: origin },
    source: { value: source },
  });
  on.target.dispatchEvent(event);
}

const report = (overrides: Partial<EmbedSessionReport> = {}): EmbedSessionReport => ({
  inquiryId: INQUIRY_ID,
  status: 'pending',
  allowedOrigins: [SHOP, 'https://*.example.org'],
  stepId: 'consent',
  stepType: 'consent',
  ...overrides,
});

/** Every message posted to the parent, each checked against the frozen schema and its target. */
function posted(on: TestHost, origin = SHOP): Record<string, unknown>[] {
  return on.parent.postMessage.mock.calls.map(([message, target]) => {
    expect(target).toBe(origin);
    expect(flowToParentMessageSchema.safeParse(message).success, JSON.stringify(message)).toBe(
      true,
    );
    return message as Record<string, unknown>;
  });
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('the handshake (C159.4)', () => {
  it('answers a hello from an allowed origin once the session names it: ready, then start', () => {
    const on = host();
    dispose = mountEmbedBridge(on);

    deliver(on, HELLO, SHOP);
    expect(on.parent.postMessage).not.toHaveBeenCalled();
    reportEmbedSession(report());

    expect(posted(on).map((message) => [message.type, message.name])).toEqual([
      ['ready', undefined],
      ['event', 'start'],
    ]);
  });

  it('matches a wildcard entry on a dot boundary only', () => {
    const allowed = host();
    dispose = mountEmbedBridge(allowed);
    reportEmbedSession(report());
    deliver(allowed, HELLO, 'https://a.b.example.org');
    expect(posted(allowed, 'https://a.b.example.org')[0]?.type).toBe('ready');
    dispose();

    const refused = host();
    dispose = mountEmbedBridge(refused);
    reportEmbedSession(report());
    deliver(refused, HELLO, 'https://evilexample.org');
    deliver(refused, HELLO, 'https://example.org');
    expect(refused.parent.postMessage).not.toHaveBeenCalled();
  });

  it('ignores a hello from another origin, another window, of another shape or too large', () => {
    const on = host();
    dispose = mountEmbedBridge(on);
    reportEmbedSession(report());

    deliver(on, HELLO, 'https://evil.example.com');
    deliver(on, HELLO, SHOP, {});
    deliver(on, { ...HELLO, version: 2 }, SHOP);
    deliver(on, { ...HELLO, extra: 'x' }, SHOP);
    deliver(on, { ...HELLO, type: 'ready' }, SHOP);
    deliver(on, 'hello', SHOP);
    deliver(on, { ...HELLO, padding: 'x'.repeat(1024 * 1024) }, SHOP);

    expect(on.parent.postMessage).not.toHaveBeenCalled();
  });

  it("never connects when the path's inquiry is not the session's (C158.3)", () => {
    const on = host({ path: `/embed/${OTHER_INQUIRY}` });
    dispose = mountEmbedBridge(on);
    reportEmbedSession(report());
    deliver(on, HELLO, SHOP);
    expect(on.parent.postMessage).not.toHaveBeenCalled();
  });

  it('cross-checks location.ancestorOrigins where present, and never gates on it', () => {
    const contradicted = host({ ancestorOrigins: ['https://evil.example.com'] });
    dispose = mountEmbedBridge(contradicted);
    reportEmbedSession(report());
    deliver(contradicted, HELLO, SHOP);
    expect(contradicted.parent.postMessage).not.toHaveBeenCalled();
    dispose();

    for (const ancestorOrigins of [[SHOP], ['null'], []]) {
      const on = host({ ancestorOrigins });
      dispose = mountEmbedBridge(on);
      reportEmbedSession(report());
      deliver(on, HELLO, SHOP);
      expect(posted(on)[0]?.type, JSON.stringify(ancestorOrigins)).toBe('ready');
      dispose();
    }
    dispose = undefined;
  });

  it('does nothing outside /embed/', () => {
    const on = host({ path: '/' });
    dispose = mountEmbedBridge(on);
    reportEmbedSession(report());
    deliver(on, HELLO, SHOP);
    expect(on.parent.postMessage).not.toHaveBeenCalled();
  });

  it('stops listening once disposed', () => {
    const on = host();
    dispose = mountEmbedBridge(on);
    dispose();
    dispose = undefined;
    reportEmbedSession(report());
    deliver(on, HELLO, SHOP);
    expect(on.parent.postMessage).not.toHaveBeenCalled();
  });
});

describe('the messages after the handshake (C159.4)', () => {
  const connected = () => {
    const on = host();
    dispose = mountEmbedBridge(on);
    reportEmbedSession(report());
    deliver(on, HELLO, SHOP);
    on.parent.postMessage.mockClear();
    return on;
  };

  it("tells each step change by the step's type only", () => {
    const on = connected();
    reportEmbedSession(report({ stepId: 'consent', stepType: 'consent' }));
    reportEmbedSession(report({ stepId: 'id_card', stepType: 'government_id' }));
    reportEmbedSession(report({ stepId: 'id_card', stepType: 'government_id' }));

    const messages = posted(on);
    expect(messages).toEqual([
      {
        source: 'openverify-flow',
        version: 1,
        type: 'event',
        name: 'step-changed',
        metadata: { 'step-type': 'government_id' },
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain('id_card');
  });

  it('tells the end once, with the status as a hint', () => {
    const on = connected();
    reportEmbedSession(report({ status: 'completed', stepId: 'done', stepType: 'completion' }));
    reportEmbedSession(report({ status: 'completed', stepId: 'done', stepType: 'completion' }));

    const messages = posted(on).filter(
      (message) => message.type !== 'event' || message.name !== 'step-changed',
    );
    expect(messages).toEqual([
      { source: 'openverify-flow', version: 1, type: 'event', name: 'complete' },
      {
        source: 'openverify-flow',
        version: 1,
        type: 'complete',
        'inquiry-id': INQUIRY_ID,
        status: 'completed',
      },
    ]);
  });

  it('tells an error by its public code', () => {
    const on = connected();
    reportEmbedError('unauthenticated');
    expect(posted(on)).toEqual([
      { source: 'openverify-flow', version: 1, type: 'event', name: 'error' },
      { source: 'openverify-flow', version: 1, type: 'error', code: 'unauthenticated' },
    ]);
  });

  it('tells a confirmed cancel with the session’s inquiry, and nothing before the handshake', () => {
    const on = connected();
    reportEmbedCancel();
    expect(posted(on)).toEqual([
      { source: 'openverify-flow', version: 1, type: 'event', name: 'cancel' },
      { source: 'openverify-flow', version: 1, type: 'cancel', 'inquiry-id': INQUIRY_ID },
    ]);
  });

  it('answers a repeated hello from the same origin with ready again', () => {
    const on = connected();
    deliver(on, HELLO, SHOP);
    expect(posted(on).map((message) => message.type)).toEqual(['ready']);
  });

  it("tells the document's height as it changes, once connected", () => {
    let notify: () => void = () => undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        disconnect = vi.fn();
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const element = { scrollHeight: 512.4 };
    const on: TestHost = {
      ...host(),
      document: { documentElement: element as unknown as HTMLElement },
    };
    dispose = mountEmbedBridge(on);
    notify();
    expect(on.parent.postMessage).not.toHaveBeenCalled();

    reportEmbedSession(report());
    deliver(on, HELLO, SHOP);
    expect(observe).toHaveBeenCalledWith(element);
    on.parent.postMessage.mockClear();
    notify();
    notify();
    element.scrollHeight = 900;
    notify();

    expect(posted(on)).toEqual([
      { source: 'openverify-flow', version: 1, type: 'resize', height: 513 },
      { source: 'openverify-flow', version: 1, type: 'resize', height: 900 },
    ]);
  });

  it('posts nothing before the handshake, however the flow moves', () => {
    const on = host();
    dispose = mountEmbedBridge(on);
    reportEmbedSession(report({ stepId: 'id_card', stepType: 'government_id' }));
    reportEmbedSession(report({ status: 'completed' }));
    reportEmbedError('application_error');
    expect(on.parent.postMessage).not.toHaveBeenCalled();
  });
});

describe('embedSessionReportOf', () => {
  it("reads the inquiry, the allowed origins and the current step's type", () => {
    const session: FlowSessionResponse = {
      ...flowSession({ status: 'pending' }),
      embed: { 'allowed-origins': [SHOP] },
      position: { 'step-id': 'government_id', state: 'active', 'previous-step-id': 'consent' },
    };
    expect(embedSessionReportOf(session)).toEqual({
      inquiryId: INQUIRY_ID,
      status: 'pending',
      allowedOrigins: [SHOP],
      stepId: 'government_id',
      stepType: 'government_id',
    });
  });

  it('allows no origin when the session names none', () => {
    expect(embedSessionReportOf(flowSession()).allowedOrigins).toEqual([]);
  });
});
