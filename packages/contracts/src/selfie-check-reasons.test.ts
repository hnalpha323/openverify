import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  NON_BLOCKING_NOT_APPLICABLE_REASONS,
  getCheckDefinition,
  reasonCodeSchema,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  EXECUTION_ERROR_REASON,
  INPUT_MISSING_REASON,
  NOT_REQUESTED_REASON,
  NO_REFERENCE_DATA_REASON,
  PROVIDER_NOT_CONFIGURED_REASON,
} from './government-id-check-reasons.js';
import { IMAGE_UNREADABLE_REASON, PHASE1_CHECK_REASONS } from './phase1-checks.js';
import {
  LEGACY_SELFIE_REASONS,
  NOT_CONSENTED_REASON,
  SELFIE_CHECK_IDS,
  SELFIE_CHECK_REASONS,
  SHARED_SELFIE_REASONS,
} from './selfie-check-reasons.js';

/** The §4.2 check ids, read from PLAN.md. */
function planSelfieChecks(): string[] {
  const plan = readFileSync(path.resolve(import.meta.dirname, '../../../docs/PLAN.md'), 'utf8');
  const start = plan.indexOf('### 4.2 Selfie');
  const section = plan.slice(start, plan.indexOf('### 4.3', start));
  return section
    .split('\n')
    .filter((line) => /^\| selfie_[a-z0-9_]+/.test(line))
    .map((line) => /selfie_[a-z0-9_]+/.exec(line)?.[0] ?? '');
}

/** The C39.2 table: each check's own reasons. */
const OWN: Readonly<Record<string, readonly string[]>> = {
  selfie_image_quality_detection: [
    'face_not_present',
    'image_blurry',
    'image_too_dark',
    'image_too_bright',
    'face_too_small',
    'resolution_too_low',
  ],
  selfie_glare_detection: ['face_glare'],
  selfie_pose_detection: ['pose_not_center', 'pose_not_left', 'pose_not_right'],
  selfie_face_covering_detection: ['face_covered'],
  selfie_glasses_detection: ['glasses_detected'],
  selfie_multiple_faces_detection: ['multiple_faces_present'],
  selfie_liveness_detection: [
    'passive_liveness_low',
    'pose_identity_mismatch',
    'automated_capture',
    'capture_replayed',
    'capture_not_live',
    'capture_device_suspicious',
  ],
  selfie_pose_repeat_detection: ['planar_motion', 'pose_frames_identical', 'duplicate_frame'],
  selfie_id_comparison: ['face_mismatch'],
  selfie_account_comparison: ['face_mismatch'],
  selfie_repeat_detection: ['face_seen_on_other_account'],
  selfie_similar_background_detection: ['background_seen_with_other_faces'],
  selfie_age_comparison: ['age_outside_limits', 'age_inconsistent_with_birthdate'],
  selfie_public_figure_detection: ['public_figure_match'],
  selfie_suspicious_entity_detection: [
    'synthetic_face_suspected',
    'provenance_marks_synthetic',
    'provider_flagged',
  ],
};

/** The frozen user-behaviour reasons (C39.2): Stage 2 may add fraud reasons only. */
const FROZEN_USER_BEHAVIOR = [
  'face_not_present',
  'image_blurry',
  'image_too_dark',
  'image_too_bright',
  'face_too_small',
  'resolution_too_low',
  'face_glare',
  'pose_not_center',
  'pose_not_left',
  'pose_not_right',
  'face_covered',
  'glasses_detected',
];

const CONSENT_GATED = [
  'selfie_account_comparison',
  'selfie_repeat_detection',
  'selfie_similar_background_detection',
];

describe('SELFIE_CHECK_IDS', () => {
  it('lists every §4.2 check, in PLAN order', () => {
    expect([...SELFIE_CHECK_IDS]).toEqual(planSelfieChecks());
    for (const id of SELFIE_CHECK_IDS) {
      expect(getCheckDefinition(id)?.verificationType, id).toBe('selfie');
    }
  });
});

describe('the shared selfie reasons (C39.2)', () => {
  it('are the C29.4 shared reasons plus not_consented', () => {
    expect([...SHARED_SELFIE_REASONS]).toEqual([
      INPUT_MISSING_REASON,
      NO_REFERENCE_DATA_REASON,
      EXECUTION_ERROR_REASON,
      PROVIDER_NOT_CONFIGURED_REASON,
      NOT_REQUESTED_REASON,
      IMAGE_UNREADABLE_REASON,
      NOT_CONSENTED_REASON,
    ]);
    expect(NOT_CONSENTED_REASON).toBe('not_consented');
  });

  it('let not_consented block a required check (it sends the verification to review)', () => {
    expect(NON_BLOCKING_NOT_APPLICABLE_REASONS).not.toContain(NOT_CONSENTED_REASON);
  });

  it('keep the legacy Phase 1 reasons stored rows carry', () => {
    expect([...LEGACY_SELFIE_REASONS]).toEqual([
      'selfie_face_not_present',
      'id_portrait_not_present',
    ]);
    expect(SELFIE_CHECK_REASONS.selfie_id_comparison).toEqual(
      expect.arrayContaining([...LEGACY_SELFIE_REASONS]),
    );
  });
});

describe('SELFIE_CHECK_REASONS (C39.2)', () => {
  it('has an entry for every selfie check and no other', () => {
    expect(Object.keys(SELFIE_CHECK_REASONS).sort()).toEqual([...SELFIE_CHECK_IDS].sort());
  });

  it.each(Object.entries(OWN))('lists the own reasons of %s', (id, own) => {
    expect(SELFIE_CHECK_REASONS[id as keyof typeof SELFIE_CHECK_REASONS]).toEqual(
      expect.arrayContaining([...own]),
    );
  });

  it('lets every check whose evidence comes from vision report input_missing and execution_error', () => {
    for (const id of SELFIE_CHECK_IDS) {
      if (getCheckDefinition(id)?.inputs.includes('vision')) {
        expect(SELFIE_CHECK_REASONS[id], id).toEqual(
          expect.arrayContaining([INPUT_MISSING_REASON, EXECUTION_ERROR_REASON]),
        );
      }
    }
  });

  it('lets every provider check report provider_not_configured', () => {
    for (const id of SELFIE_CHECK_IDS) {
      if (getCheckDefinition(id)?.inputs.includes('provider')) {
        expect(SELFIE_CHECK_REASONS[id], id).toContain(PROVIDER_NOT_CONFIGURED_REASON);
      }
    }
  });

  it('gates the matching checks on consent (C42.3)', () => {
    for (const id of CONSENT_GATED) {
      expect(SELFIE_CHECK_REASONS[id as keyof typeof SELFIE_CHECK_REASONS], id).toContain(
        NOT_CONSENTED_REASON,
      );
    }
  });

  it('keeps PHASE1_CHECK_REASONS.selfie a subset', () => {
    for (const [id, reasons] of Object.entries(PHASE1_CHECK_REASONS)) {
      if (id.startsWith('selfie_')) {
        expect(SELFIE_CHECK_REASONS[id as keyof typeof SELFIE_CHECK_REASONS], id).toEqual(
          expect.arrayContaining([...reasons]),
        );
      }
    }
  });

  it('uses only snake_case codes, each once per check', () => {
    for (const [id, reasons] of Object.entries(SELFIE_CHECK_REASONS)) {
      expect(new Set(reasons).size, id).toBe(reasons.length);
      for (const reason of reasons) {
        expect(reasonCodeSchema.safeParse(reason).success, `${id} ${reason}`).toBe(true);
      }
    }
  });

  it('freezes the user-behaviour reasons (C39.2)', () => {
    const userBehavior = SELFIE_CHECK_IDS.filter(
      (id) => getCheckDefinition(id)?.checkType === 'user_behavior',
    );
    const notApplicableOnly = new Set<string>(
      SHARED_SELFIE_REASONS.filter((reason) => reason !== IMAGE_UNREADABLE_REASON),
    );
    const own = [
      ...new Set(
        userBehavior
          .flatMap((id) => SELFIE_CHECK_REASONS[id])
          .filter((reason) => !notApplicableOnly.has(reason) && reason !== IMAGE_UNREADABLE_REASON),
      ),
    ].sort();
    expect(own).toEqual([...FROZEN_USER_BEHAVIOR].sort());
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SELFIE_CHECK_REASONS)).toBe(true);
    for (const reasons of Object.values(SELFIE_CHECK_REASONS)) {
      expect(Object.isFrozen(reasons)).toBe(true);
    }
  });
});
