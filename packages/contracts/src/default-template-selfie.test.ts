/** C45.1: the default template's selfie step, matching consent and selfie checks (Phase 4). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_INTEGRITY_NOTICE_TEXT_KEY } from './flow-signals.js';
import { SELFIE_CHECK_IDS } from './selfie-check-reasons.js';
import { defaultInquiryTemplateAttributes } from './inquiry-templates.js';

const fixture = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../contracts/fixtures/flows/default-gov-id-selfie.json',
    ),
    'utf8',
  ),
) as unknown;

const template = defaultInquiryTemplateAttributes();
const stepOf = (type: string) =>
  template.flow.steps.find((step) => step.type === type) as Record<string, unknown> | undefined;
const checks = template['verification-config'].selfie?.checks ?? {};
const ids = (enabled: boolean, required: boolean) =>
  Object.entries(checks)
    .filter(([, check]) => check.enabled === enabled && check.required === required)
    .map(([id]) => id)
    .sort();

describe('the default template (C45.1)', () => {
  it('asks for three poses with active liveness', () => {
    expect(stepOf('selfie')).toMatchObject({
      poses: ['center', 'left', 'right'],
      liveness: 'active',
    });
  });

  it('offers the matching consent as an optional text', () => {
    expect(stepOf('consent')).toMatchObject({
      textKeys: ['consent.biometric', 'consent.processing', SESSION_INTEGRITY_NOTICE_TEXT_KEY],
      optionalTextKeys: ['consent.biometric-matching'],
    });
  });

  it('shows the session-integrity notice as a required text, so session integrity collects (C94.6, ADR 0006)', () => {
    const consent = stepOf('consent') as { textKeys?: string[]; optionalTextKeys?: string[] };
    expect(consent.textKeys).toContain('notice.session-integrity');
    expect(consent.optionalTextKeys ?? []).not.toContain('notice.session-integrity');
  });

  it('requires image quality, pose, multiple faces, liveness and the ID comparison', () => {
    expect(ids(true, true)).toEqual(
      [
        'selfie_image_quality_detection',
        'selfie_pose_detection',
        'selfie_multiple_faces_detection',
        'selfie_liveness_detection',
        'selfie_id_comparison',
      ].sort(),
    );
  });

  it('enables the rest advisory, and leaves age and public figure off', () => {
    expect(ids(true, false)).toEqual(
      [
        'selfie_glare_detection',
        'selfie_pose_repeat_detection',
        'selfie_account_comparison',
        'selfie_repeat_detection',
        'selfie_similar_background_detection',
        'selfie_face_covering_detection',
        'selfie_glasses_detection',
        'selfie_suspicious_entity_detection',
      ].sort(),
    );
    expect(ids(false, false)).toEqual(
      ['selfie_age_comparison', 'selfie_public_figure_detection'].sort(),
    );
    expect(Object.keys(checks).sort()).toEqual([...SELFIE_CHECK_IDS].sort());
  });

  it('is published as a new flow version (3: the session-integrity notice, C94.6)', () => {
    expect(template.flow.metadata.version).toBe(3);
  });

  it('is the golden flows fixture', () => {
    expect(fixture).toEqual(template);
  });
});
