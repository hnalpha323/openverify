/**
 * C266.2: `useOpenVerify` mounts `@openverify/js`'s embed in the element its `ref` is given, keeps
 * nothing but the embed's own events as state, calls the latest handlers without mounting again,
 * mounts again when the frame's identity changes, and removes the frame on unmount. Every value
 * is synthetic; the flow origin is a reserved name.
 */
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INITIAL_OPEN_VERIFY_STATE,
  useOpenVerify,
  type OpenVerifyBinding,
  type OpenVerifyOptions,
} from './use-open-verify.js';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const OTHER_INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH8';
const SESSION_TOKEN = `ovs_${'ReactSyntheticSessionToken'.padEnd(43, 'x')}`;
const FLOW = 'https://flow.example.com';

const BASE: OpenVerifyOptions = {
  flowUrl: FLOW,
  inquiryId: INQUIRY_ID,
  sessionToken: SESSION_TOKEN,
};

const flowMessage = (message: Record<string, unknown>) => ({
  source: 'openverify-flow',
  version: 1,
  ...message,
});

afterEach(() => {
  cleanup();
});

/** Renders a host that reports each binding it gets; the last one is the current state. */
function renderHost(
  options: OpenVerifyOptions,
  wrap: (node: ReactElement) => ReactElement = (n) => n,
) {
  const bindings: OpenVerifyBinding[] = [];
  function Host(props: { readonly options: OpenVerifyOptions; readonly show?: boolean }) {
    const binding = useOpenVerify(props.options);
    bindings.push(binding);
    return props.show === false ? <p>hidden</p> : <section data-testid="host" ref={binding.ref} />;
  }
  const view = render(wrap(<Host options={options} />));
  return {
    ...view,
    bindings,
    current: () => {
      const last = bindings.at(-1);
      if (last === undefined) {
        throw new Error('the host never rendered');
      }
      return last;
    },
    rerenderWith: (next: OpenVerifyOptions, show?: boolean) => {
      view.rerender(wrap(<Host options={next} {...(show === undefined ? {} : { show })} />));
    },
  };
}

const frameIn = (root: ParentNode): HTMLIFrameElement => {
  const frames = [...root.querySelectorAll('iframe')];
  expect(frames).toHaveLength(1);
  const [frame] = frames;
  if (frame === undefined) {
    throw new Error('no frame');
  }
  return frame;
};

/** A message as the browser would deliver it from the frame at the flow origin. */
const deliver = (frame: HTMLIFrameElement, data: unknown, origin = FLOW) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin, source: frame.contentWindow }),
    );
  });
};

describe('mounting (C266.2 over C159.2)', () => {
  it('mounts the embed in the element the ref is given, with the frame URL of @openverify/js', () => {
    const host = renderHost(BASE);
    const frame = frameIn(host.getByTestId('host'));
    const src = new URL(frame.src);

    expect(`${src.origin}${src.pathname}`).toBe(`${FLOW}/embed/${INQUIRY_ID}`);
    expect(src.hash).toContain(SESSION_TOKEN);
    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms allow-popups',
    );
    expect(host.current().state).toEqual(INITIAL_OPEN_VERIFY_STATE);
  });

  it('passes the frame options through: title, height, width, language and style variant', () => {
    const host = renderHost({
      ...BASE,
      iframeTitle: 'Verify your identity',
      frameHeight: 600,
      frameWidth: 500,
      language: 'fr-CA',
      styleVariant: 'dark',
    });
    const frame = frameIn(host.getByTestId('host'));

    expect(frame.title).toBe('Verify your identity');
    expect(frame.style.height).toBe('600px');
    expect(frame.style.maxWidth).toBe('500px');
    expect(new URL(frame.src).search).toBe('?language=fr-CA&style-variant=dark');
  });

  it('mounts one frame under StrictMode, which mounts every effect twice', () => {
    const host = renderHost(BASE, (node) => <StrictMode>{node}</StrictMode>);

    frameIn(host.getByTestId('host'));
  });

  it('removes the frame and stops listening when the element goes away', () => {
    const onComplete = vi.fn();
    const host = renderHost({ ...BASE, onComplete });
    const frame = frameIn(host.getByTestId('host'));

    host.rerenderWith({ ...BASE, onComplete }, false);
    expect(host.container.querySelectorAll('iframe')).toHaveLength(0);
    deliver(
      frame,
      flowMessage({ type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'completed' }),
    );
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('removes the frame on unmount', () => {
    const host = renderHost(BASE);
    frameIn(host.getByTestId('host'));

    host.unmount();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('mounts again, with the state reset, when the inquiry changes', () => {
    const host = renderHost(BASE);
    const first = frameIn(host.getByTestId('host'));
    deliver(first, flowMessage({ type: 'ready' }));
    expect(host.current().state.status).toBe('ready');

    host.rerenderWith({ ...BASE, inquiryId: OTHER_INQUIRY_ID });
    const second = frameIn(host.getByTestId('host'));
    expect(second).not.toBe(first);
    expect(new URL(second.src).pathname).toBe(`/embed/${OTHER_INQUIRY_ID}`);
    expect(host.current().state).toEqual(INITIAL_OPEN_VERIFY_STATE);
  });

  it('keeps the same frame when only a handler changes, and calls the newest handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const host = renderHost({ ...BASE, onReady: first });
    const frame = frameIn(host.getByTestId('host'));

    host.rerenderWith({ ...BASE, onReady: second });
    expect(frameIn(host.getByTestId('host'))).toBe(frame);
    deliver(frame, flowMessage({ type: 'ready' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("the embed's own events as state (C266.2, C159.4-C159.6)", () => {
  it('moves through loaded and ready, calling onLoad and onReady', () => {
    const onLoad = vi.fn();
    const onReady = vi.fn();
    const host = renderHost({ ...BASE, onLoad, onReady });
    const frame = frameIn(host.getByTestId('host'));

    act(() => {
      frame.dispatchEvent(new Event('load'));
    });
    expect(host.current().state.status).toBe('loaded');
    expect(onLoad).toHaveBeenCalledTimes(1);

    deliver(frame, flowMessage({ type: 'ready' }));
    expect(host.current().state.status).toBe('ready');
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('keeps the last event (its name and step type only) and calls onEvent', () => {
    const onEvent = vi.fn();
    const host = renderHost({ ...BASE, onEvent });
    const frame = frameIn(host.getByTestId('host'));

    deliver(
      frame,
      flowMessage({ type: 'event', name: 'step-changed', metadata: { 'step-type': 'selfie' } }),
    );
    expect(host.current().state.lastEvent).toEqual({
      name: 'step-changed',
      metadata: { 'step-type': 'selfie' },
    });
    expect(onEvent).toHaveBeenCalledWith({
      name: 'step-changed',
      metadata: { 'step-type': 'selfie' },
    });
  });

  it('keeps only the events the allowlist names', () => {
    const onEvent = vi.fn();
    const host = renderHost({ ...BASE, onEvent, eventsAllowlist: ['complete'] });
    const frame = frameIn(host.getByTestId('host'));

    deliver(frame, flowMessage({ type: 'event', name: 'start' }));
    expect(host.current().state.lastEvent).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();

    deliver(frame, flowMessage({ type: 'event', name: 'complete' }));
    expect(host.current().state.lastEvent).toEqual({ name: 'complete', metadata: {} });
  });

  it('keeps the completion as a hint and calls onComplete', () => {
    const onComplete = vi.fn();
    const host = renderHost({ ...BASE, onComplete });
    const frame = frameIn(host.getByTestId('host'));

    deliver(
      frame,
      flowMessage({ type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'completed' }),
    );
    expect(host.current().state).toMatchObject({
      status: 'complete',
      completion: { inquiryId: INQUIRY_ID, status: 'completed' },
    });
    expect(onComplete).toHaveBeenCalledWith({ inquiryId: INQUIRY_ID, status: 'completed' });
  });

  it('marks a cancel and calls onCancel', () => {
    const onCancel = vi.fn();
    const host = renderHost({ ...BASE, onCancel });
    const frame = frameIn(host.getByTestId('host'));

    deliver(frame, flowMessage({ type: 'cancel', 'inquiry-id': INQUIRY_ID }));
    expect(host.current().state.status).toBe('cancelled');
    expect(onCancel).toHaveBeenCalledWith({ inquiryId: INQUIRY_ID });
  });

  it("keeps the flow's error and calls onError", () => {
    const onError = vi.fn();
    const host = renderHost({ ...BASE, onError });
    const frame = frameIn(host.getByTestId('host'));

    deliver(frame, flowMessage({ type: 'error', code: 'unauthenticated' }));
    expect(host.current().state).toMatchObject({
      status: 'error',
      error: { code: 'unauthenticated', message: 'The verification link is not valid any more.' },
    });
    expect(onError).toHaveBeenCalledWith({
      code: 'unauthenticated',
      message: 'The verification link is not valid any more.',
    });
  });

  it('ignores a message from another origin, as the embed does', () => {
    const onReady = vi.fn();
    const host = renderHost({ ...BASE, onReady });
    const frame = frameIn(host.getByTestId('host'));

    deliver(frame, flowMessage({ type: 'ready' }), 'https://attacker.example.net');
    expect(host.current().state.status).toBe('mounting');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('turns options the embed refuses into an error state, never a thrown render', () => {
    const onError = vi.fn();
    const host = renderHost({ ...BASE, flowUrl: 'http://flow.example.com', onError });

    expect(host.container.querySelectorAll('iframe')).toHaveLength(0);
    expect(host.current().state).toMatchObject({
      status: 'error',
      error: { code: 'invalid_config' },
    });
    expect(onError).toHaveBeenCalledWith({
      code: 'invalid_config',
      message: 'flowUrl must be an https URL without a query, fragment or credentials',
    });
  });

  it('turns refused options into an error state when no onError is given', () => {
    const host = renderHost({ ...BASE, inquiryId: 'not-an-inquiry' });

    expect(host.current().state).toMatchObject({
      status: 'error',
      error: { code: 'invalid_config', message: 'inquiryId must be an inquiry id (inq_...)' },
    });
  });

  it('drops an event from a frame it has already replaced', () => {
    const host = renderHost(BASE);
    const first = frameIn(host.getByTestId('host'));
    host.rerenderWith({ ...BASE, inquiryId: OTHER_INQUIRY_ID });

    deliver(first, flowMessage({ type: 'ready' }));
    expect(host.current().state).toEqual(INITIAL_OPEN_VERIFY_STATE);
  });
});
