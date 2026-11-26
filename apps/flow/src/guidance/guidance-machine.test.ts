/**
 * C46.1, C40.11: the guidance state machine with an injected detector's faces. The auto-capture
 * triggers come from the shared constants file (`contracts/fixtures/flow/selfie-capture.json`)
 * and the capture's `guidance` (`selfie-capture-created.json`).
 */
import { SELFIE_CAPTURE_CLIENT, flowSelfieCaptureDocumentSchema } from '@openverify/contracts';
import { SELFIE_CHECK_CONFIG_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import created from '../../../../contracts/fixtures/flow/selfie-capture-created.json';
import constants from '../../../../contracts/fixtures/flow/selfie-capture.json';
import {
  GUIDANCE_FACE_SCORE_THRESHOLD,
  GUIDANCE_LIMITS,
  centreTrigger,
  guidanceThresholds,
  sideTrigger,
  startGuidance,
  updateGuidance,
  type GuidanceEvent,
  type GuidanceState,
  type GuidanceThresholds,
} from './guidance-machine';
import type { DetectedFace } from './yunet-decode';

const FRAME = { width: 320, height: 240 } as const;
const GUIDANCE = flowSelfieCaptureDocumentSchema.parse(created).data.attributes.guidance;
const THRESHOLDS = guidanceThresholds(GUIDANCE, SELFIE_CAPTURE_CLIENT);

interface FaceOptions {
  readonly yaw?: number;
  readonly cx?: number;
  readonly cy?: number;
  /** Box height as a share of the frame height. */
  readonly height?: number;
  readonly score?: number;
}

/** A face in the guidance frame whose five landmarks read exactly `yaw`. */
function face({
  yaw = 0,
  cx = FRAME.width / 2,
  cy = FRAME.height / 2,
  height = 0.5,
  score = 0.95,
}: FaceOptions = {}): DetectedFace {
  const h = height * FRAME.height;
  const w = h * 0.75;
  const eye = w * 0.2;
  return {
    box: [cx - w / 2, cy - h / 2, w, h],
    landmarks: [
      [cx - eye, cy - h * 0.1],
      [cx + eye, cy - h * 0.1],
      [cx + yaw * 2 * eye, cy + h * 0.05],
      [cx - eye * 0.8, cy + h * 0.25],
      [cx + eye * 0.8, cy + h * 0.25],
    ],
    score,
  };
}

function seen(now: number, ...faces: DetectedFace[]): GuidanceEvent {
  return { type: 'faces', now, faces, frame: FRAME };
}

/** Runs `events` from a fresh prompt for `pose`, with a ready detector. */
function run(
  pose: 'center' | 'left' | 'right',
  events: readonly GuidanceEvent[],
  { centreYawRatio = null as number | null, thresholds = THRESHOLDS } = {},
): GuidanceState {
  return events.reduce(
    (state, event) => updateGuidance(state, thresholds, event),
    startGuidance({ pose, now: 0, detector: 'ready', centreYawRatio }),
  );
}

describe('the auto-capture triggers (C40.11)', () => {
  it('take the client constants from the shared constants file', () => {
    expect(SELFIE_CAPTURE_CLIENT).toMatchObject({
      'side-trigger-factor': constants.client['side-trigger-factor'],
      'center-trigger-factor': constants.client['center-trigger-factor'],
      'manual-shutter-after-ms': constants.client['manual-shutter-after-ms'],
      'guidance-hz': constants.client['guidance-hz'],
      'preview-width-px': constants.client['preview-width-px'],
    });
    expect(THRESHOLDS).toEqual({
      maxCenterYawRatio: constants.server['max-center-yaw-ratio'],
      minSideYawRatioChange: constants.server['min-side-yaw-ratio-change'],
      holdMs: constants.client['hold-ms'],
      sideTriggerFactor: constants.client['side-trigger-factor'],
      centerTriggerFactor: constants.client['center-trigger-factor'],
      manualShutterAfterMs: constants.client['manual-shutter-after-ms'],
    });
  });

  it('capture a side pose at 1.25 x the server minimum and the centre at 0.8 x its maximum', () => {
    expect(sideTrigger(THRESHOLDS)).toBeCloseTo(
      constants.client['side-trigger-factor'] * constants.server['min-side-yaw-ratio-change'],
      12,
    );
    expect(centreTrigger(THRESHOLDS)).toBeCloseTo(
      constants.client['center-trigger-factor'] * constants.server['max-center-yaw-ratio'],
      12,
    );
  });

  it('follow the capture guidance the server sends, not a copy of the defaults', () => {
    const custom = guidanceThresholds(
      { 'max-center-yaw-ratio': 0.05, 'min-side-yaw-ratio-change': 0.1, 'hold-ms': 800 },
      SELFIE_CAPTURE_CLIENT,
    );

    expect(centreTrigger(custom)).toBeCloseTo(0.04, 12);
    expect(sideTrigger(custom)).toBeCloseTo(0.125, 12);
    expect(custom.holdMs).toBe(800);
  });
});

describe('the guidance limits', () => {
  it('find faces as the vision service does (its default face score threshold)', () => {
    expect(GUIDANCE_FACE_SCORE_THRESHOLD).toBe(0.9);
  });

  it('ask for a face no smaller than the server accepts, and count bystanders as it does', () => {
    const quality = SELFIE_CHECK_CONFIG_DEFAULTS.selfie_image_quality_detection;
    const faces = SELFIE_CHECK_CONFIG_DEFAULTS.selfie_multiple_faces_detection;
    expect(GUIDANCE_LIMITS.minFaceHeightRatio).toBeGreaterThan(
      Number(quality?.['min-face-height-ratio']?.value ?? Number.POSITIVE_INFINITY),
    );
    expect(GUIDANCE_LIMITS.minSecondaryFaceAreaRatio).toBe(
      Number(faces?.['min-secondary-face-area-ratio']?.value),
    );
  });
});

describe('the centre pose', () => {
  const trigger = centreTrigger(THRESHOLDS);

  it('captures once a frontal face has been held for hold-ms', () => {
    const held = run('center', [seen(0, face()), seen(125, face()), seen(499, face())]);
    expect(held.message).toBe('hold-still');
    expect(held.autoCapture).toBe(false);

    const captured = updateGuidance(held, THRESHOLDS, seen(500, face()));
    expect(captured.autoCapture).toBe(true);
  });

  it('captures just inside the trigger, and asks to look straight just beyond it', () => {
    const inside = trigger - 1e-6;
    expect(
      run('center', [seen(0, face({ yaw: inside })), seen(500, face({ yaw: -inside }))])
        .autoCapture,
    ).toBe(true);

    const turned = run('center', [
      seen(0, face({ yaw: trigger + 0.001 })),
      seen(600, face({ yaw: trigger + 0.001 })),
    ]);
    expect(turned.message).toBe('look-straight');
    expect(turned.autoCapture).toBe(false);
  });

  it('starts the hold again when the face moves away', () => {
    const state = run('center', [
      seen(0, face()),
      seen(300, face({ cx: 20 })),
      seen(400, face()),
      seen(800, face()),
    ]);

    expect(state.autoCapture).toBe(false);
    expect(updateGuidance(state, THRESHOLDS, seen(900, face())).autoCapture).toBe(true);
  });

  it('records the yaw ratio of the latest well-placed face, for the side poses', () => {
    expect(run('center', [seen(0, face({ yaw: 0.012 }))]).yawRatio).toBeCloseTo(0.012, 10);
    expect(run('center', [seen(0, face({ yaw: 0.012 })), seen(125)]).yawRatio).toBeNull();
  });
});

describe.each([
  ['left', 1, 'turn-left'],
  ['right', -1, 'turn-right'],
] as const)('the %s pose', (pose, direction, message) => {
  const trigger = sideTrigger(THRESHOLDS);
  const centre = 0.01;
  const at = (change: number) => face({ yaw: centre + direction * change });

  it('captures once the yaw ratio changed from the user’s own centre by the trigger', () => {
    const state = run(pose, [seen(0, at(trigger + 1e-6)), seen(500, at(trigger + 0.02))], {
      centreYawRatio: centre,
    });

    expect(state.autoCapture).toBe(true);
  });

  it('asks to turn further while the change is below the trigger', () => {
    const state = run(pose, [seen(0, at(trigger - 0.005)), seen(700, at(trigger - 0.005))], {
      centreYawRatio: centre,
    });

    expect(state.message).toBe(message);
    expect(state.autoCapture).toBe(false);
  });

  it('never takes a turn the other way for the prompted one', () => {
    const state = run(pose, [seen(0, at(-trigger * 2)), seen(700, at(-trigger * 2))], {
      centreYawRatio: centre,
    });

    expect(state.message).toBe(message);
    expect(state.autoCapture).toBe(false);
  });

  it('leaves the photo to the manual shutter without the user’s centre frame', () => {
    const state = run(pose, [seen(0, at(0.5)), seen(9_999, at(0.5))]);
    expect(state.autoCapture).toBe(false);
    expect(state.manualShutter).toBe(false);

    expect(updateGuidance(state, THRESHOLDS, seen(10_000, at(0.5))).manualShutter).toBe(true);
  });
});

describe('framing', () => {
  it.each([
    ['no face', [], 'no-face'],
    ['a face the server would not find', [face({ score: 0.85 })], 'no-face'],
    ['two faces', [face(), face({ cx: 60, height: 0.3 })], 'multiple-faces'],
    ['a face too far away', [face({ height: 0.2 })], 'too-far'],
    ['a face too close', [face({ height: 0.9 })], 'too-close'],
    ['a face off to the side', [face({ cx: 260 })], 'off-centre'],
    ['a face too high', [face({ cy: 60 })], 'off-centre'],
  ] as const)('asks the user to fix %s', (_label, faces, expected) => {
    const state = run('center', [seen(0, ...faces), seen(800, ...faces)]);

    expect(state.message).toBe(expected);
    expect(state.autoCapture).toBe(false);
    expect(state.heldSince).toBeNull();
  });

  it('ignores a small face in the background, as the server does', () => {
    const state = run('center', [
      seen(0, face(), face({ cx: 40, cy: 40, height: 0.2 })),
      seen(500, face(), face({ cx: 40, cy: 40, height: 0.2 })),
    ]);

    expect(state.autoCapture).toBe(true);
  });

  it('judges the largest face as the user', () => {
    const state = run('center', [seen(0, face({ cx: 40, height: 0.15 }), face())]);

    expect(state.message).toBe('hold-still');
  });
});

describe('the manual shutter (C40.11)', () => {
  it('appears after manual-shutter-after-ms, even while no frame is analysed', () => {
    const waiting = run('center', [{ type: 'tick', now: THRESHOLDS.manualShutterAfterMs - 1 }]);
    expect(waiting.manualShutter).toBe(false);

    const ready = updateGuidance(waiting, THRESHOLDS, {
      type: 'tick',
      now: THRESHOLDS.manualShutterAfterMs,
    });
    expect(ready.manualShutter).toBe(true);
  });

  it('appears at once when the detector cannot run, and says so', () => {
    const loading = startGuidance({
      pose: 'center',
      now: 0,
      detector: 'loading',
      centreYawRatio: null,
    });
    expect(loading.message).toBe('starting');
    expect(loading.manualShutter).toBe(false);

    const unavailable = updateGuidance(loading, THRESHOLDS, {
      type: 'detector',
      now: 50,
      status: 'unavailable',
    });
    expect(unavailable.message).toBe('manual');
    expect(unavailable.manualShutter).toBe(true);
    expect(
      startGuidance({ pose: 'left', now: 0, detector: 'unavailable', centreYawRatio: null }),
    ).toMatchObject({ message: 'manual', manualShutter: true });
  });

  it('stays once shown', () => {
    const state = run('center', [
      { type: 'tick', now: THRESHOLDS.manualShutterAfterMs },
      seen(THRESHOLDS.manualShutterAfterMs + 100, face()),
    ]);

    expect(state.manualShutter).toBe(true);
  });

  it.each([
    ['center', 'look-straight'],
    ['left', 'turn-left'],
    ['right', 'turn-right'],
  ] as const)(
    'starts a %s prompt with its own instruction when the detector is ready',
    (pose, message) => {
      expect(startGuidance({ pose, now: 0, detector: 'ready', centreYawRatio: null }).message).toBe(
        message,
      );
    },
  );

  it('starts guiding once a loading detector is ready', () => {
    const state = run('center', [{ type: 'detector', now: 10, status: 'ready' }, seen(20)]);

    expect(state.detector).toBe('ready');
    expect(state.message).toBe('no-face');
  });
});

describe('announcements', () => {
  it('announce a message once it has stayed on screen for a while', () => {
    const early = run('center', [seen(0), seen(1_000)]);
    expect(early.message).toBe('no-face');
    expect(early.announcement).toBeNull();

    const settled = updateGuidance(early, THRESHOLDS, seen(1_500));
    expect(settled.announcement).toBe('no-face');
  });

  it('keep the last announcement while a new message settles', () => {
    const state = run('center', [seen(0), seen(1_500), seen(1_600, face({ height: 0.2 }))]);

    expect(state.message).toBe('too-far');
    expect(state.announcement).toBe('no-face');
  });
});

describe('thresholds (types)', () => {
  it('are plain numbers', () => {
    const thresholds: GuidanceThresholds = THRESHOLDS;
    expect(Object.values(thresholds).every((value) => typeof value === 'number')).toBe(true);
  });
});
