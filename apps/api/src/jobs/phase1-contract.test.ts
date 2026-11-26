/**
 * The Phase 1 evaluators (`@openverify/checks`) and the shared vocabulary
 * (`@openverify/contracts`) must agree: the clients translate exactly the reason codes listed
 * in `PHASE1_CHECK_REASONS`.
 */
import {
  IMAGE_UNREADABLE_CHECK_REASON,
  NOT_IMPLEMENTED_CHECK_REASON,
  PHASE1_EVALUATED_CHECKS,
  evaluateGovernmentIdChecks,
  evaluateSelfieChecks,
  unreadableImageChecks,
  type GovernmentIdAnalysisInput,
  type SelfieAnalysisInput,
} from '@openverify/checks';
import {
  IMAGE_UNREADABLE_REASON,
  INPUT_MISSING_REASON,
  LEGACY_SELFIE_REASONS,
  NOT_IMPLEMENTED_REASON,
  PHASE1_CHECKS,
  PHASE1_CHECK_REASONS,
  type VerificationConfig,
} from '@openverify/contracts';
import type { CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { visionFixture } from './testing.js';

/** The Phase 1 template: the C7 checks only (C36 enables every §4.1 check by default). */
const enableAll = (checks: readonly string[]) => ({
  checks: Object.fromEntries(checks.map((id) => [id, { enabled: true, required: true }])),
});
const config: VerificationConfig = {
  'government-id': enableAll(PHASE1_CHECKS.government_id),
  // The Phase 1 selfie checks (C45.1 made the default template require every Phase 4 one).
  selfie: enableAll(PHASE1_CHECKS.selfie),
};

function worstGovernmentId(): CheckResult[] {
  const analysis = visionFixture('analyze-government-id') as GovernmentIdAnalysisInput;
  analysis.sides.front.quality = {
    ...analysis.sides.front.quality,
    is_blurry: true,
    has_glare: true,
  };
  analysis.sides.front.portrait = null;
  // Phase 12A C9: a side whose document was measured is judged on that measure, so the worst
  // card's document is blurred too.
  const measured = analysis.sides.front.document_quality;
  if (measured != null) {
    analysis.sides.front.document_quality = { ...measured, blur_score: 1 };
  }
  return [
    ...evaluateGovernmentIdChecks(
      { analysis, requiredSides: 'both', uploads: { front: null, back: null } },
      config['government-id'] ?? { checks: {} },
    ),
    ...evaluateGovernmentIdChecks(
      {
        analysis,
        requiredSides: 'both',
        uploads: { front: { sha256: 'a' }, back: { sha256: 'a' } },
      },
      config['government-id'] ?? { checks: {} },
    ),
  ];
}

function worstSelfies(): CheckResult[] {
  const analysis = visionFixture('analyze-selfie') as SelfieAnalysisInput;
  const face = analysis.poses.center.face;
  const portraitOf = visionFixture('embed-face') as { face: { embedding: number[] } };
  analysis.poses.center.quality = {
    ...analysis.poses.center.quality,
    is_blurry: true,
    is_too_dark: true,
    is_too_bright: true,
  };
  // C43: a second face counts from 25% of the primary face's area (bystanders and posters).
  analysis.poses.center.faces = [
    ...analysis.poses.center.faces,
    { bbox: [420, 104, 140, 190], score: 1 },
  ];
  const mismatch = evaluateSelfieChecks(
    { analysis, idPortrait: { embedding: portraitOf.face.embedding, verificationId: 'ver_X' } },
    config.selfie ?? { checks: {} },
  );
  analysis.poses.center.face = null;
  const missing = evaluateSelfieChecks(
    { analysis, idPortrait: null },
    config.selfie ?? { checks: {} },
  );
  expect(face).not.toBeNull();
  return [...mismatch, ...missing];
}

describe('Phase 1 checks contract', () => {
  it('evaluates exactly the C7 checks', () => {
    expect(PHASE1_EVALUATED_CHECKS).toEqual(PHASE1_CHECKS);
  });

  it('reports not_implemented with the shared reason code', () => {
    expect(NOT_IMPLEMENTED_CHECK_REASON).toBe(NOT_IMPLEMENTED_REASON);
  });

  it('reports an image vision cannot read with the shared reason code', () => {
    expect(IMAGE_UNREADABLE_CHECK_REASON).toBe(IMAGE_UNREADABLE_REASON);
  });

  it('emits only reason codes listed in PHASE1_CHECK_REASONS, and every listed code', () => {
    const unreadable = [
      ...unreadableImageChecks('government_id', config['government-id'] ?? { checks: {} }),
      ...unreadableImageChecks('selfie', config.selfie ?? { checks: {} }),
    ];
    const results = [...worstGovernmentId(), ...worstSelfies(), ...unreadable];
    // A check that did not run answers a shared reason, never a check-specific one (C43: the
    // comparison of a selfie without a face has no input).
    expect(
      new Set(results.filter((result) => result.status !== 'failed').flatMap((r) => r.reasons)),
    ).toEqual(new Set([IMAGE_UNREADABLE_REASON, INPUT_MISSING_REASON]));
    const emitted = new Map<string, Set<string>>();
    for (const result of results.filter((candidate) => candidate.status === 'failed')) {
      const reasons = emitted.get(result.name) ?? new Set<string>();
      result.reasons.forEach((reason) => reasons.add(reason));
      emitted.set(result.name, reasons);
    }
    // C39.2: the legacy selfie reasons stay listed for stored rows; Phase 4 never emits them.
    const legacy: readonly string[] = LEGACY_SELFIE_REASONS;
    const listed = Object.fromEntries(
      Object.entries(PHASE1_CHECK_REASONS).map(([name, reasons]) => [
        name,
        reasons.filter((reason) => !legacy.includes(reason)).sort(),
      ]),
    );
    const produced = Object.fromEntries(
      [...emitted.entries()].map(([name, reasons]) => [name, [...reasons].sort()]),
    );
    expect(produced).toEqual(listed);
  });
});
