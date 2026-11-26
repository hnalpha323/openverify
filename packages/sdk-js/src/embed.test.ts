/**
 * C159.2, C159.4-C159.6: `embed()` mounts the flow in a sandboxed iframe with its fixed tokens and
 * the credentials in the fragment, posts its hello to the flow origin only, accepts a message only
 * from the flow origin and its own iframe, and hands each to its callback. Every value is synthetic;
 * the flow origin is a reserved name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embed, type EmbedHandle, type EmbedOptions } from './embed';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const SESSION_TOKEN = `ovs_${'SdkSyntheticSessionToken'.padEnd(43, 'x')}`;
const FLOW = 'https://flow.example.com';
const flowMessage = (message: Record<string, unknown>) => ({
  source: 'openverify-flow',
  version: 1,
  ...message,
});

let container: HTMLElement;
let handle: EmbedHandle | undefined;

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'verify';
  document.body.append(container);
});

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  container.remove();
});

const mount = (options: Partial<EmbedOptions> = {}) => {
  handle = embed({
    container,
    flowUrl: FLOW,
    inquiryId: INQUIRY_ID,
    sessionToken: SESSION_TOKEN,
    ...options,
  });
  const frame = container.querySelector('iframe');
  if (frame === null) {
    throw new Error('no iframe');
  }
  return frame;
};

/** A message as the browser would deliver it from `source` at `origin`. */
const deliver = (data: unknown, origin: string, source: MessageEventSource | null) => {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
};

describe('the iframe (C159.2)', () => {
  it('has the fixed sandbox tokens, the camera, no referrer, a title and the frame URL', () => {
    const frame = mount();

    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms allow-popups',
    );
    expect(frame.getAttribute('allow')).toBe('camera');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.title).toBe('Identity verification');
    const src = new URL(frame.src);
    expect(`${src.origin}${src.pathname}`).toBe(`${FLOW}/embed/${INQUIRY_ID}`);
    expect(src.search).toBe('');
    expect(src.hash).toContain(SESSION_TOKEN);
  });

  it('takes a selector, a title, a height and a width of at most 768 px', () => {
    const frame = mount({
      container: '#verify',
      iframeTitle: 'Verify your identity',
      frameHeight: 600,
      frameWidth: 900,
    });
    expect(frame.title).toBe('Verify your identity');
    expect(frame.style.height).toBe('600px');
    expect(frame.style.maxWidth).toBe('768px');
  });

  it('reports invalid_config without mounting, never echoing a token', () => {
    const onError = vi.fn();
    handle = embed({
      container,
      flowUrl: 'http://flow.example.com',
      inquiryId: INQUIRY_ID,
      sessionToken: SESSION_TOKEN,
      onError,
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(onError).toHaveBeenCalledWith({
      code: 'invalid_config',
      message: expect.any(String) as unknown,
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain(SESSION_TOKEN);

    embed({
      container: '#missing',
      flowUrl: FLOW,
      inquiryId: INQUIRY_ID,
      sessionToken: SESSION_TOKEN,
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('throws on an invalid configuration when no onError is given', () => {
    expect(() =>
      embed({ container, flowUrl: FLOW, inquiryId: 'inq_bad', sessionToken: SESSION_TOKEN }),
    ).toThrow(/inquiryId/);
  });
});

describe('the protocol (C159.4)', () => {
  it('posts its hello to the flow origin when the frame loads, and calls onLoad', () => {
    const onLoad = vi.fn();
    const frame = mount({ onLoad });
    const target = frame.contentWindow;
    if (target === null) {
      throw new Error('no window');
    }
    const post = vi.spyOn(target, 'postMessage');

    frame.dispatchEvent(new Event('load'));

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { source: 'openverify-parent', version: 1, type: 'hello' },
      FLOW,
    );
  });

  it('hands the flow its callbacks: ready, events, completion, cancel and errors', () => {
    const calls = {
      onReady: vi.fn(),
      onEvent: vi.fn(),
      onComplete: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    };
    const frame = mount(calls);
    const source = frame.contentWindow;

    deliver(flowMessage({ type: 'ready' }), FLOW, source);
    deliver(
      flowMessage({ type: 'event', name: 'step-changed', metadata: { 'step-type': 'selfie' } }),
      FLOW,
      source,
    );
    deliver(
      flowMessage({ type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'completed' }),
      FLOW,
      source,
    );
    deliver(flowMessage({ type: 'cancel', 'inquiry-id': INQUIRY_ID }), FLOW, source);
    deliver(flowMessage({ type: 'error', code: 'camera_error' }), FLOW, source);

    expect(calls.onReady).toHaveBeenCalledTimes(1);
    expect(calls.onEvent).toHaveBeenCalledWith({
      name: 'step-changed',
      metadata: { 'step-type': 'selfie' },
    });
    expect(calls.onComplete).toHaveBeenCalledWith({ inquiryId: INQUIRY_ID, status: 'completed' });
    expect(calls.onCancel).toHaveBeenCalledWith({ inquiryId: INQUIRY_ID });
    expect(calls.onError).toHaveBeenCalledWith({
      code: 'camera_error',
      message: expect.any(String) as unknown,
    });
  });

  it('ignores a message from another origin, another window or of another shape', () => {
    const onReady = vi.fn();
    const onComplete = vi.fn();
    const frame = mount({ onReady, onComplete });
    const other = document.createElement('iframe');
    document.body.append(other);

    deliver(flowMessage({ type: 'ready' }), 'https://evil.example.com', frame.contentWindow);
    deliver(
      flowMessage({ type: 'ready' }),
      'https://flow.example.com.evil.example',
      frame.contentWindow,
    );
    deliver(flowMessage({ type: 'ready' }), FLOW, other.contentWindow);
    deliver(flowMessage({ type: 'ready' }), FLOW, window);
    deliver({ type: 'ready' }, FLOW, frame.contentWindow);
    deliver(
      flowMessage({ type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'completed', fields: {} }),
      FLOW,
      frame.contentWindow,
    );

    expect(onReady).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    other.remove();
  });

  it('passes only the allow-listed events', () => {
    const onEvent = vi.fn();
    const frame = mount({ onEvent, eventsAllowlist: ['complete'] });
    deliver(flowMessage({ type: 'event', name: 'start' }), FLOW, frame.contentWindow);
    deliver(flowMessage({ type: 'event', name: 'complete' }), FLOW, frame.contentWindow);
    expect(onEvent.mock.calls).toEqual([[{ name: 'complete', metadata: {} }]]);
  });

  it('follows resize only when no height was given', () => {
    const frame = mount();
    deliver(flowMessage({ type: 'resize', height: 720 }), FLOW, frame.contentWindow);
    expect(frame.style.height).toBe('720px');
    handle?.destroy();

    const fixed = mount({ frameHeight: 500 });
    deliver(flowMessage({ type: 'resize', height: 720 }), FLOW, fixed.contentWindow);
    expect(fixed.style.height).toBe('500px');
  });

  it('removes its frame and stops listening on destroy, once', () => {
    const onReady = vi.fn();
    const frame = mount({ onReady });
    const source = frame.contentWindow;
    handle?.destroy();
    handle?.destroy();

    deliver(flowMessage({ type: 'ready' }), FLOW, source);
    expect(container.querySelector('iframe')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
  });
});
