/**
 * C46.1, K8-33 (Workflow 8D): the guidance a prompt shows is that prompt's own. When the prompt
 * changes, the state the previous prompt left ("Hold still", a manual shutter, an auto-capture) is
 * never returned for the new one, not even for the render before the new prompt's guidance starts.
 * React runs that start in a passive effect; under load the scheduler can yield between the commit
 * and the effect, and a test (or a user) that acts on the old prompt's "Hold still" in that window
 * acts on the wrong prompt.
 */
import { SELFIE_CAPTURE_CLIENT, SELFIE_CAPTURE_GUIDANCE_DEFAULTS } from '@openverify/contracts';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HeldFrame, SampledFrame } from '../lib/sample-frame';
import { guidanceThresholds, type GuidanceState } from '../guidance/guidance-machine';
import { fakeCamera, fakeDetector } from '../testing/fake-camera';
import { syntheticFace } from '../testing/synthetic-faces';
import { FAST_POLLING } from '../test-utils';
import { FlowEnvironmentProvider } from '../flow/flow-environment';
import { useGuidance, type GuidancePrompt } from './use-guidance';

const THRESHOLDS = guidanceThresholds(SELFIE_CAPTURE_GUIDANCE_DEFAULTS, SELFIE_CAPTURE_CLIENT);

interface Rendered {
  readonly key: string | null;
  readonly state: GuidanceState | null;
}

function guided(faces = [syntheticFace({ yaw: 0.01 })]) {
  const detector = fakeDetector(faces);
  const camera = fakeCamera({ detector });
  const video = { current: document.createElement('video') };
  const renders: Rendered[] = [];
  function Probe({ prompt }: { readonly prompt: GuidancePrompt | null }) {
    const state = useGuidance({
      prompt,
      thresholds: THRESHOLDS,
      detector,
      video,
      onAutoCapture: () => undefined,
      onDetectorFailed: () => undefined,
    });
    renders.push({ key: prompt?.key ?? null, state });
    return null;
  }
  // One provider value for every render, so a rerender keeps the same tree (and the hook's state).
  const environment = { ...FAST_POLLING, ...camera.environment };
  const view = (prompt: GuidancePrompt | null) => (
    <FlowEnvironmentProvider value={environment}>
      <Probe prompt={prompt} />
    </FlowEnvironmentProvider>
  );
  const latest = () => renders.at(-1)?.state ?? null;
  return { detector, camera, renders, view, latest };
}

const CENTRE: GuidancePrompt = { key: 'cap:0:0', pose: 'center', centreYawRatio: null };
const LEFT: GuidancePrompt = { key: 'cap:1:0', pose: 'left', centreYawRatio: 0.01 };

describe('useGuidance: each prompt shows its own guidance (C46.1, K8-33)', () => {
  it('never returns the previous prompt’s state for the next prompt', async () => {
    const { renders, view, latest } = guided();
    const { rerender } = render(view(CENTRE));
    await waitFor(() => {
      expect(latest()?.message).toBe('hold-still');
    });

    rerender(view(LEFT));
    await waitFor(() => {
      expect(latest()?.pose).toBe('left');
    });

    const forLeft = renders.filter((render) => render.key === LEFT.key);
    expect(forLeft.map((render) => render.state?.pose ?? null)).not.toContain('center');
  });

  it('starts a retaken photo of the same pose from nothing, never from the last shot’s hold', async () => {
    const { detector, camera, renders, view, latest } = guided();
    const { rerender } = render(view(LEFT));
    detector.faces = [syntheticFace({ yaw: 0.01 + 0.1 })];
    await waitFor(() => {
      expect(latest()?.message).toBe('hold-still');
    });
    camera.clock.advance(SELFIE_CAPTURE_GUIDANCE_DEFAULTS['hold-ms']);
    await waitFor(() => {
      expect(latest()?.autoCapture).toBe(true);
    });

    const retake: GuidancePrompt = { ...LEFT, key: 'cap:1:1' };
    rerender(view(retake));
    await waitFor(() => {
      expect(latest()?.message).toBe('hold-still');
    });

    const forRetake = renders.filter((render) => render.key === retake.key);
    expect(forRetake.map((render) => render.state?.autoCapture ?? null)).not.toContain(true);
  });
});

describe('useGuidance: an auto-capture is handed the frame it judged (KP10-3)', () => {
  /** A guidance whose every sampled frame holds its own copy; `onAutoCapture` records the hand-over. */
  function holding(faces = [syntheticFace({ yaw: 0.01 })]) {
    const detector = fakeDetector(faces);
    const camera = fakeCamera({ detector });
    const video = { current: document.createElement('video') };
    const helds: HeldFrame[] = [];
    const sampleFrame = (): SampledFrame => {
      const held: HeldFrame = { take: vi.fn(() => null), release: vi.fn() };
      helds.push(held);
      return { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4), held };
    };
    const handed: {
      readonly held: HeldFrame | null | undefined;
      readonly last: HeldFrame | undefined;
    }[] = [];
    function Probe({ prompt }: { readonly prompt: GuidancePrompt | null }) {
      useGuidance({
        prompt,
        thresholds: THRESHOLDS,
        detector,
        video,
        onAutoCapture: (_state: GuidanceState, held?: HeldFrame | null) => {
          handed.push({ held, last: helds.at(-1) });
        },
        onDetectorFailed: () => undefined,
      });
      return null;
    }
    const environment = { ...FAST_POLLING, ...camera.environment, sampleFrame };
    const view = (prompt: GuidancePrompt | null) => (
      <FlowEnvironmentProvider value={environment}>
        <Probe prompt={prompt} />
      </FlowEnvironmentProvider>
    );
    return { camera, helds, handed, view };
  }

  it('hands over the copy of the very frame whose faces completed the hold', async () => {
    const { camera, helds, handed, view } = holding();
    render(view(CENTRE));
    await waitFor(() => {
      expect(helds.length).toBeGreaterThan(0);
    });
    camera.clock.advance(SELFIE_CAPTURE_GUIDANCE_DEFAULTS['hold-ms']);

    await waitFor(() => {
      expect(handed).toHaveLength(1);
    });
    expect(handed[0]?.held).toBeDefined();
    expect(handed[0]?.held).toBe(handed[0]?.last);
  });

  it('releases the last frame’s copy when the prompt’s guidance stops', async () => {
    const { helds, handed, view } = holding([]);
    const { rerender } = render(view(CENTRE));
    await waitFor(() => {
      expect(helds.length).toBeGreaterThan(1);
    });

    rerender(view(null));
    const last = helds.at(-1);

    expect(last?.release).toHaveBeenCalledTimes(1);
    expect(handed).toEqual([]);
  });
});
