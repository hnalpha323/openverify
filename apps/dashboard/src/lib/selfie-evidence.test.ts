import type { FileResource, VerificationCheck } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  SELFIE_IDS as IDS,
  selfieCapture,
  selfieChecks,
  selfieInquiryDocument,
  selfieVerification,
  supersededCapture,
} from '../testing/selfie-fixtures';
import {
  appliedThreshold,
  capturesOf,
  consumedCapture,
  idComparisonOf,
  livenessEvidenceOf,
  posePhotos,
  promptOrder,
  referenceFront,
} from './selfie-evidence';

const files = selfieInquiryDocument().included.filter(
  (resource): resource is FileResource => resource.type === 'file',
);
const selfieFiles = files.filter((file) => file.relationships.verification.data.id === IDS.selfie);

function checkNamed(name: string): VerificationCheck {
  const check = selfieChecks().find((candidate) => candidate.name === name);
  if (check === undefined) throw new Error(`No ${name}`);
  return check;
}

/** A check with its provenance replaced. */
const withProvenance = (
  check: VerificationCheck,
  provenance: VerificationCheck['provenance'],
): VerificationCheck => ({ ...check, provenance });

describe('appliedThreshold (C39.3)', () => {
  it('reads the value and the basis of a default from the provenance', () => {
    expect(appliedThreshold(checkNamed('selfie_id_comparison'), 'threshold')).toEqual({
      key: 'threshold',
      value: 0.371,
      origin: 'calibrated',
    });
    expect(appliedThreshold(checkNamed('selfie_liveness_detection'), 'min-passive-score')).toEqual({
      key: 'min-passive-score',
      value: 0.55,
      origin: 'provisional',
    });
  });

  it('says a key without a basis was set by the template', () => {
    expect(
      appliedThreshold(checkNamed('selfie_liveness_detection'), 'min-side-identity-cosine'),
    ).toEqual({ key: 'min-side-identity-cosine', value: 0.45, origin: 'template' });
  });

  it('says so too for a current selfie result whose every key the template set (the basis map is then left out)', () => {
    const check = withProvenance(checkNamed('selfie_id_comparison'), {
      'implementation-version': 2,
      thresholds: { threshold: 0.4 },
    });

    expect(appliedThreshold(check, 'threshold')?.origin).toBe('template');
  });

  it('claims no basis for a result older than the current implementation, or of a check without bases', () => {
    const phase3 = withProvenance(checkNamed('selfie_id_comparison'), {
      'implementation-version': 1,
      thresholds: { threshold: 0.363 },
    });
    const governmentId: VerificationCheck = {
      name: 'id_blur_detection',
      status: 'passed',
      reasons: [],
      requirement: 'required',
      metadata: {},
      provenance: { 'implementation-version': 1, thresholds: { 'min-sharpness': 15 } },
    };

    expect(appliedThreshold(phase3, 'threshold')?.origin).toBe('unrecorded');
    expect(appliedThreshold(governmentId, 'min-sharpness')?.origin).toBe('unrecorded');
  });

  it('has nothing without the check, its provenance or the key', () => {
    expect(appliedThreshold(undefined, 'threshold')).toBeNull();
    expect(
      appliedThreshold(withProvenance(checkNamed('selfie_id_comparison'), null), 'threshold'),
    ).toBeNull();
    expect(appliedThreshold(checkNamed('selfie_id_comparison'), 'max-pose-cosine')).toBeNull();
  });
});

describe('the captures of a verification (C40.1)', () => {
  const other = selfieCapture({}, 'self_01JB0000000000000000000099');
  const foreign = {
    ...other,
    relationships: {
      ...other.relationships,
      verification: {
        data: { type: 'verification/selfie' as const, id: 'ver_01JB0000000000000000000099' },
      },
    },
  };

  it('keeps those of the verification, newest first', () => {
    expect(
      capturesOf([supersededCapture(), foreign, selfieCapture()], IDS.selfie).map(
        (capture) => capture.id,
      ),
    ).toEqual([IDS.capture, IDS.supersededCapture]);
  });

  it('finds the capture submit consumed, the one with a submission time', () => {
    expect(consumedCapture([selfieCapture(), supersededCapture()])?.id).toBe(IDS.capture);
    expect(consumedCapture([supersededCapture()])).toBeUndefined();
    expect(
      consumedCapture([
        selfieCapture({
          status: 'errored',
          'error-code': 'processing_failed',
          'processed-at': null,
        }),
      ])?.id,
    ).toBe(IDS.capture);
  });
});

describe('the poses in prompt order (C40.10, C47)', () => {
  it('follows the attributes, which name the consumed capture’s prompts', () => {
    expect(promptOrder(selfieVerification(), undefined, selfieFiles)).toEqual([
      'center',
      'right',
      'left',
    ]);
  });

  it('falls back to the consumed capture’s prompts, then to the files of a selfie without a capture', () => {
    const noPoses = selfieVerification({ poses: null });

    expect(
      promptOrder(noPoses, selfieCapture({ prompts: ['center', 'left', 'right'] }), selfieFiles),
    ).toEqual(['center', 'left', 'right']);
    expect(promptOrder(noPoses, undefined, selfieFiles)).toEqual(['center', 'left', 'right']);
  });

  it('pairs each pose with its photo, a missing one included, and keeps an unprompted photo last', () => {
    const photos = posePhotos(
      ['center', 'right'],
      [...selfieFiles.filter((file) => file.attributes.kind !== 'selfie-right')],
    );

    expect(photos.map(({ pose, file, prompted }) => [pose, file?.id, prompted])).toEqual([
      ['center', IDS.selfieCenter, true],
      ['right', undefined, true],
      ['left', IDS.selfieLeft, false],
    ]);
  });

  it('ignores files that are not selfie poses, and keeps unprompted photos in pose order', () => {
    expect(posePhotos(['center'], files).map((photo) => photo.file?.id)).toEqual([
      IDS.selfieCenter,
      IDS.selfieLeft,
      IDS.selfieRight,
    ]);
  });
});

describe('idComparisonOf (C40.10, C43)', () => {
  it('reads the similarity, the threshold with its basis, and the government ID compared', () => {
    const comparison = idComparisonOf(selfieVerification());

    expect(comparison).toMatchObject({
      similarity: 0.6512,
      threshold: { key: 'threshold', value: 0.371, origin: 'calibrated' },
      referenceId: IDS.governmentId,
      missing: null,
    });
    expect(comparison.result?.name).toBe('selfie_id_comparison');
  });

  it('names what was missing when nothing was compared', () => {
    const checks = selfieChecks().map((check) =>
      check.name === 'selfie_id_comparison'
        ? {
            ...check,
            status: 'not_applicable' as const,
            reasons: ['no_reference_data'],
            metadata: { reference: 'government_id' },
          }
        : check,
    );

    expect(
      idComparisonOf(selfieVerification({ checks, 'document-similarity-score': null })),
    ).toMatchObject({ similarity: null, referenceId: null, missing: 'government_id' });
  });

  it('takes no reference from a value that is not a verification id', () => {
    const checks = selfieChecks().map((check) =>
      check.name === 'selfie_id_comparison'
        ? {
            ...check,
            metadata: { ...check.metadata, id_verification_id: 'inq_01JB0000000000000000000001' },
          }
        : check,
    );

    expect(idComparisonOf(selfieVerification({ checks })).referenceId).toBeNull();
  });

  it('has nothing without the check (redacted, or not enabled)', () => {
    expect(
      idComparisonOf(selfieVerification({ checks: [], 'document-similarity-score': null })),
    ).toEqual({
      result: undefined,
      similarity: null,
      threshold: null,
      referenceId: null,
      missing: null,
    });
  });

  it('finds the front of the government ID compared', () => {
    expect(referenceFront(files, IDS.governmentId)?.id).toBe(IDS.front);
    expect(referenceFront(files, null)).toBeUndefined();
    expect(referenceFront(files, IDS.selfie)).toBeUndefined();
  });
});

describe('livenessEvidenceOf (C43)', () => {
  it('reads the components, the flags, the order and the scores with their thresholds', () => {
    const evidence = livenessEvidenceOf(selfieVerification());

    expect(evidence.components).toEqual([
      { component: 'passive', status: 'passed' },
      { component: 'active', status: 'passed' },
      { component: 'integrity', status: 'not_executed' },
    ]);
    expect(evidence).toMatchObject({
      integrityFlags: ['file-path-label', 'webdriver'],
      timingFlags: ['uploads-batched'],
      orderFollowed: true,
      testCaptureDevice: true,
      judgedPoses: ['right', 'left'],
      livenessScore: {
        score: 0.8811,
        threshold: { key: 'min-passive-score', value: 0.55, origin: 'provisional' },
      },
    });
    // The side poses in prompt order, each against the side-identity threshold.
    expect(evidence.sideSimilarities).toEqual([
      {
        pose: 'right',
        score: 0.8123,
        threshold: { key: 'min-side-identity-cosine', value: 0.45, origin: 'template' },
      },
      {
        pose: 'left',
        score: 0.7954,
        threshold: { key: 'min-side-identity-cosine', value: 0.45, origin: 'template' },
      },
    ]);
  });

  it('reads malformed or missing metadata as not recorded, never as a pass', () => {
    const checks = selfieChecks().map((check) =>
      check.name === 'selfie_liveness_detection'
        ? {
            ...check,
            metadata: {
              components: { passive: 7, active: 'a_status_from_the_future' },
              'integrity-flags': 'webdriver',
              'timing-flags': [1, 'timing-missing'],
              'order-followed': 'yes',
              'test-capture-device': 'true',
              'judged-poses': null,
            },
          }
        : check,
    );

    const evidence = livenessEvidenceOf(selfieVerification({ checks }));

    expect(evidence.components).toEqual([
      { component: 'passive', status: null },
      { component: 'active', status: 'a_status_from_the_future' },
      { component: 'integrity', status: null },
    ]);
    expect(evidence).toMatchObject({
      integrityFlags: [],
      timingFlags: ['timing-missing'],
      orderFollowed: undefined,
      testCaptureDevice: false,
      judgedPoses: null,
    });
  });

  it('has no components without the check, and only the prompted sides', () => {
    const evidence = livenessEvidenceOf(
      selfieVerification({ checks: [], poses: ['center'], 'liveness-score': null }),
    );

    expect(evidence.result).toBeUndefined();
    expect(evidence.components).toEqual([]);
    expect(evidence.livenessScore).toEqual({ score: null, threshold: null });
    expect(evidence.sideSimilarities).toEqual([]);
  });
});
