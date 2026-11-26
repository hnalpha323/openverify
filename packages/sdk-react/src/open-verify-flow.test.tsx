/**
 * C266.2: `<OpenVerifyFlow>` renders one container with the embed mounted in it and hands the
 * embed's events to its handlers. Every value is synthetic; the flow origin is a reserved name.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as entry from './index.js';
import { OpenVerifyFlow } from './open-verify-flow.js';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const ONE_TIME_TOKEN = `ovo_${'ReactSyntheticOneTimeToken'.padEnd(43, 'x')}`;
const FLOW = 'https://flow.example.com/verify';

afterEach(() => {
  cleanup();
});

describe('<OpenVerifyFlow> (C266.2)', () => {
  it('renders a container with its id, class and style, and the frame inside it', () => {
    render(
      <OpenVerifyFlow
        id="verify"
        className="verification"
        style={{ minHeight: 320 }}
        flowUrl={FLOW}
        inquiryId={INQUIRY_ID}
        oneTimeLink={ONE_TIME_TOKEN}
        iframeTitle="Identity check"
      />,
    );
    const frame = screen.getByTitle<HTMLIFrameElement>('Identity check');
    const container = frame.parentElement;

    expect(container?.id).toBe('verify');
    expect(container?.className).toBe('verification');
    expect(container?.style.minHeight).toBe('320px');
    const src = new URL(frame.src);
    expect(src.pathname).toBe(`/verify/embed/${INQUIRY_ID}`);
    expect(src.hash).toBe(`#inquiry-id=${INQUIRY_ID}&one-time-token=${ONE_TIME_TOKEN}`);
  });

  it("hands the embed's completion to onComplete", () => {
    const onComplete = vi.fn();
    render(
      <OpenVerifyFlow
        flowUrl={FLOW}
        inquiryId={INQUIRY_ID}
        oneTimeLink={ONE_TIME_TOKEN}
        onComplete={onComplete}
      />,
    );
    const frame = screen.getByTitle<HTMLIFrameElement>('Identity verification');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: 'openverify-flow',
            version: 1,
            type: 'complete',
            'inquiry-id': INQUIRY_ID,
            status: 'needs_review',
          },
          origin: 'https://flow.example.com',
          source: frame.contentWindow,
        }),
      );
    });
    expect(onComplete).toHaveBeenCalledWith({ inquiryId: INQUIRY_ID, status: 'needs_review' });
  });

  it('renders the container without a frame when the options are refused', () => {
    const onError = vi.fn();
    const { container } = render(
      <OpenVerifyFlow flowUrl={FLOW} inquiryId={INQUIRY_ID} onError={onError} />,
    );

    expect(container.querySelectorAll('div')).toHaveLength(1);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_config' }));
  });
});

describe('the entry point (C266.2)', () => {
  it('exports the component, the hook and the initial state, and nothing that runs on import', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'INITIAL_OPEN_VERIFY_STATE',
      'OpenVerifyFlow',
      'useOpenVerify',
    ]);
    expect(Object.isFrozen(entry.INITIAL_OPEN_VERIFY_STATE)).toBe(true);
  });
});
