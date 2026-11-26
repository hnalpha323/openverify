import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORT_WASM, YUNET_MODEL } from '../guidance/guidance-assets';
import {
  DEFAULT_FLOW_ENVIRONMENT,
  FlowEnvironmentProvider,
  useFlowEnvironment,
} from './flow-environment';

function ShowPolling() {
  const { pollIntervalMs, maxPolls } = useFlowEnvironment();
  return <output>{`${String(pollIntervalMs)}/${String(maxPolls)}`}</output>;
}

describe('FlowEnvironment', () => {
  it('polls every two seconds for about two minutes by default', () => {
    render(<ShowPolling />);

    expect(screen.getByRole('status')).toHaveTextContent('2000/60');
  });

  it('lets a provider override part of the environment', () => {
    render(
      <FlowEnvironmentProvider value={{ pollIntervalMs: 5 }}>
        <ShowPolling />
      </FlowEnvironmentProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('5/60');
  });

  it('reads the server’s times on the wall clock, and counts down every second, by default (C64.1)', () => {
    const before = Date.now();
    const read = DEFAULT_FLOW_ENVIRONMENT.currentTime();

    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(Date.now());
    expect(DEFAULT_FLOW_ENVIRONMENT.countdownIntervalMs).toBe(1000);
  });

  it('uses the browser camera by default', async () => {
    // jsdom has no navigator.mediaDevices.
    await expect(DEFAULT_FLOW_ENVIRONMENT.requestCamera()).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    });
  });

  it('captures frames with a canvas by default', async () => {
    const video = document.createElement('video');

    // A video without a frame cannot be captured.
    await expect(DEFAULT_FLOW_ENVIRONMENT.captureFrame(video)).rejects.toThrow(
      'The camera has not delivered a frame yet',
    );
  });

  it('captures documents with the canvas encoder and the photo check by default (Phase 12A F1)', async () => {
    const video = document.createElement('video');
    const stream = { getVideoTracks: () => [] } as unknown as MediaStream;

    await expect(
      DEFAULT_FLOW_ENVIRONMENT.captureDocument(video, stream, { width: 360, height: 480 }),
    ).rejects.toThrow('The camera has not delivered a frame yet');
  });

  describe('the face detector (C46.1)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('guides at 8 Hz by default (C40.11), on a clock that only moves forward', () => {
      expect(DEFAULT_FLOW_ENVIRONMENT.guidanceIntervalMs).toBe(125);
      expect(DEFAULT_FLOW_ENVIRONMENT.now()).toBeLessThanOrEqual(DEFAULT_FLOW_ENVIRONMENT.now());
    });

    it('loads the guidance files from the flow’s own origin, and tries again after a failure', async () => {
      const requested: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          requested.push(input instanceof Request ? input.url : String(input));
          return Promise.resolve(new Response('', { status: 404 }));
        }),
      );

      await expect(DEFAULT_FLOW_ENVIRONMENT.loadFaceDetector()).resolves.toBeNull();
      await expect(DEFAULT_FLOW_ENVIRONMENT.loadFaceDetector()).resolves.toBeNull();

      const origin = window.location.origin;
      expect(requested).toEqual(
        expect.arrayContaining([`${origin}/${YUNET_MODEL.path}`, `${origin}/${ORT_WASM.path}`]),
      );
      // Nothing cached a failed load: the second call fetched again.
      expect(requested.filter((url) => url.endsWith(YUNET_MODEL.path))).toHaveLength(2);
    });

    it('samples no frame from a video that has none', () => {
      expect(DEFAULT_FLOW_ENVIRONMENT.sampleFrame(document.createElement('video'), 320)).toBeNull();
    });
  });
});
