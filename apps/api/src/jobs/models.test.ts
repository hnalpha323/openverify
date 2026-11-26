import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANONICAL_FACE_MESH, MODEL_DIGESTS, governmentIdModels, selfieModels } from './models.js';
import { governmentIdFixture, selfieFixture } from './testing.js';

interface ManifestEntry {
  name: string;
  sha256: string;
}

const manifest = JSON.parse(
  readFileSync(new URL('../../../../models/manifest.json', import.meta.url), 'utf8'),
) as { models: ManifestEntry[] };

describe('model digests (C29.2 provenance)', () => {
  it('pins every model the government ID and selfie analyses report, by its manifest SHA-256', () => {
    expect(Object.keys(MODEL_DIGESTS).sort()).toEqual([
      'minifasnet-v1se-4.0',
      'minifasnet-v2-2.7',
      'pp-ocrv6-small-det',
      'pp-ocrv6-small-rec',
      'sface-2021dec',
      'yunet-2026may',
    ]);
    for (const [id, digest] of Object.entries(MODEL_DIGESTS)) {
      const entry = manifest.models.find((model) => model.name === digest.manifest);
      expect(entry, id).toBeDefined();
      expect(digest.sha256, id).toBe(entry?.sha256);
    }
  });

  it('names the face and text models of an analysis by the role the evaluators read', () => {
    const versions = governmentIdFixture().model_versions;

    expect(governmentIdModels(versions)).toEqual({
      faceDetector: { id: 'yunet-2026may', sha256: MODEL_DIGESTS['yunet-2026may']?.sha256 },
      faceRecognizer: { id: 'sface-2021dec', sha256: MODEL_DIGESTS['sface-2021dec']?.sha256 },
      textDetector: {
        id: 'pp-ocrv6-small-det',
        sha256: MODEL_DIGESTS['pp-ocrv6-small-det']?.sha256,
      },
      textRecognizer: {
        id: 'pp-ocrv6-small-rec',
        sha256: MODEL_DIGESTS['pp-ocrv6-small-rec']?.sha256,
      },
    });
  });

  it('leaves out a text model that did not run, and a model it cannot pin', () => {
    expect(
      governmentIdModels({
        detector: 'yunet-2099',
        recognizer: 'sface-2021dec',
        text_detector: null,
        text_recognizer: null,
      }),
    ).toEqual({
      faceRecognizer: { id: 'sface-2021dec', sha256: MODEL_DIGESTS['sface-2021dec']?.sha256 },
    });
  });
});

describe('selfie model provenance (C39.1)', () => {
  it('pins the canonical face points the head pose rests on, by its manifest SHA-256', () => {
    const entry = manifest.models.find((model) => model.name === 'canonical_face_mesh');
    expect(CANONICAL_FACE_MESH).toEqual({
      id: 'mediapipe-canonical-face-model-a908d66',
      sha256: entry?.sha256,
    });
  });

  it('names the face, anti-spoofing and canonical mesh models by the role the evaluators read', () => {
    const versions = selfieFixture().model_versions;

    expect(selfieModels(versions)).toEqual({
      faceDetector: { id: 'yunet-2026may', sha256: MODEL_DIGESTS['yunet-2026may']?.sha256 },
      faceRecognizer: { id: 'sface-2021dec', sha256: MODEL_DIGESTS['sface-2021dec']?.sha256 },
      antiSpoofV2: {
        id: 'minifasnet-v2-2.7',
        sha256: MODEL_DIGESTS['minifasnet-v2-2.7']?.sha256,
      },
      antiSpoofV1se: {
        id: 'minifasnet-v1se-4.0',
        sha256: MODEL_DIGESTS['minifasnet-v1se-4.0']?.sha256,
      },
      canonicalFaceMesh: CANONICAL_FACE_MESH,
    });
  });

  it('leaves out an anti-spoofing model that did not run (no model files), and one it cannot pin', () => {
    expect(
      selfieModels({
        detector: 'yunet-2026may',
        recognizer: 'sface-2099',
        anti_spoof_v2: null,
        anti_spoof_v1se: null,
      }),
    ).toEqual({
      faceDetector: { id: 'yunet-2026may', sha256: MODEL_DIGESTS['yunet-2026may']?.sha256 },
      canonicalFaceMesh: CANONICAL_FACE_MESH,
    });
  });
});
