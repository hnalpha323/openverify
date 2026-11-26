/**
 * C29.2 provenance of the models a government ID or selfie result rests on: the id vision reports
 * in `model_versions`, and its SHA-256 pinned in `models/manifest.json` (a test keeps the two equal).
 * A model id this table does not know is left out of provenance, never given a made-up digest.
 */
import type { GovernmentIdModels, SelfieModels } from '@openverify/checks';
import type { CheckModel } from '@openverify/core';
import type { GovernmentIdModelVersions, SelfieModelVersions } from '../ports.js';

export interface ModelDigest {
  /** The `models/manifest.json` entry the weights come from. */
  manifest: string;
  sha256: string;
}

/** Each model id vision reports, with its manifest entry and pinned SHA-256. */
export const MODEL_DIGESTS: Readonly<Record<string, ModelDigest>> = Object.freeze({
  'yunet-2026may': {
    manifest: 'face_detection_yunet',
    sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
  },
  'sface-2021dec': {
    manifest: 'face_recognition_sface',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  },
  'pp-ocrv6-small-det': {
    manifest: 'text_detection_ppocrv6_small',
    sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
  },
  'pp-ocrv6-small-rec': {
    manifest: 'text_recognition_ppocrv6_small',
    sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
  },
  'minifasnet-v2-2.7': {
    manifest: 'anti_spoof_minifasnet_v2',
    sha256: 'b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907',
  },
  'minifasnet-v1se-4.0': {
    manifest: 'anti_spoof_minifasnet_v1se',
    sha256: 'ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676',
  },
});

/** The model `id` pinned by its digest, or `undefined` when it is unknown or did not run. */
function pinned(id: string | null): CheckModel | undefined {
  const digest = id === null || !Object.hasOwn(MODEL_DIGESTS, id) ? undefined : MODEL_DIGESTS[id];
  return id === null || digest === undefined ? undefined : { id, sha256: digest.sha256 };
}

/** The pinned models of a government ID analysis, by the role the evaluators name. */
export function governmentIdModels(versions: GovernmentIdModelVersions): GovernmentIdModels {
  const roles = {
    faceDetector: pinned(versions.detector),
    faceRecognizer: pinned(versions.recognizer),
    textDetector: pinned(versions.text_detector),
    textRecognizer: pinned(versions.text_recognizer),
  };
  return Object.fromEntries(
    Object.entries(roles).filter((entry): entry is [string, CheckModel] => entry[1] !== undefined),
  );
}

/**
 * The canonical face points vision's head pose solves against (C39.1, C41.1): vendored from
 * MediaPipe's `canonical_face_model.obj` at a908d66 (`models/manifest.json`
 * `canonical_face_mesh`). Vision reports no version for them, so the id names the commit.
 */
export const CANONICAL_FACE_MESH: CheckModel = Object.freeze({
  id: 'mediapipe-canonical-face-model-a908d66',
  sha256: '8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618',
});

/**
 * The pinned models of a selfie analysis (C39.1), by the role the evaluators name. The
 * anti-spoofing models are `null` when vision runs without their files (no passive evidence);
 * the canonical mesh is always the vendored one.
 */
export function selfieModels(versions: SelfieModelVersions): SelfieModels {
  const roles = {
    faceDetector: pinned(versions.detector),
    faceRecognizer: pinned(versions.recognizer),
    antiSpoofV2: pinned(versions.anti_spoof_v2),
    antiSpoofV1se: pinned(versions.anti_spoof_v1se),
    canonicalFaceMesh: CANONICAL_FACE_MESH,
  };
  return Object.fromEntries(
    Object.entries(roles).filter((entry): entry is [string, CheckModel] => entry[1] !== undefined),
  );
}
