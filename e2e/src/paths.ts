/** Fixed locations of the e2e run. Static, because specs need them before the global setup runs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const REPO_ROOT = path.dirname(E2E_DIR);

/** Gitignored: the run's random secrets and ports. */
export const ENV_FILE = path.join(E2E_DIR, '.env.e2e');
/** Gitignored: service logs, the e2e flow build, Playwright traces and reports. */
export const ARTIFACTS_DIR = path.join(E2E_DIR, '.artifacts');

const GENERATED = path.join(REPO_ROOT, 'fixtures', 'generated');
/** The C45.2 selfie set (`synthetic_selfie.py`): clips, still triples, spoofs, composites. */
const SELFIE = path.join(GENERATED, 'selfie');
/**
 * C208.1 (Workflow 10C): the directory the e2e API reads the sandbox test chip's other face from
 * (`OPENVERIFY_SANDBOX_CHIP_FACES`; person B's centre still). Generated on the host, never in an image.
 */
export const SANDBOX_CHIP_FACES_DIR = SELFIE;

/**
 * Synthetic inputs. `fixtures/generated/` is written by
 * `services/vision/tools/make_synthetic_fixtures.py` from the pinned public-domain faces.
 */
/** C146.3: the local HTTPS receiver's throwaway certificate, made at each stack start. */
export const RECEIVER_TLS = {
  certificate: path.join(ARTIFACTS_DIR, 'receiver-tls', 'certificate.pem'),
  key: path.join(ARTIFACTS_DIR, 'receiver-tls', 'key.pem'),
} as const;

export const FIXTURES = {
  /** The happy-path TD1 card front (C36, no specimen marker) carrying person A's portrait. */
  idFront: path.join(GENERATED, 'id-front.jpg'),
  /** Card back with a valid TD1 machine-readable zone. */
  idBack: path.join(GENERATED, 'id-back.jpg'),
  /**
   * Person A's head-turn clip (C45.2, matching the ID): 640x480 MJPEG at 30 fps, looping
   * centre, left, centre, right from the centre, re-posed from another photo than the ID's.
   * Chromium's fake camera plays it (`--use-file-for-fake-video-capture`), one launch per clip.
   */
  headTurnMatching: path.join(SELFIE, 'head-turn-a.mjpeg'),
  /** Person B's head-turn clip (C45.2): someone other than the ID's holder. */
  headTurnDifferent: path.join(SELFIE, 'head-turn-b.mjpeg'),
  /** Person A's centre still, drifting but never turning (C45.2 static replay). */
  staticReplay: path.join(SELFIE, 'static-replay-a.mjpeg'),
  /** The generator version that wrote `fixtures/generated/` (C36); absent before a full run. */
  generatorStamp: path.join(GENERATED, '.generator-version'),
  /** The C7 default template, as the dev seed loads it. */
  defaultTemplate: path.join(
    REPO_ROOT,
    'contracts',
    'fixtures',
    'flows',
    'default-gov-id-selfie.json',
  ),
} as const;

/** A pose of a C45.2 still triple (`fixtures/generated/selfie/head-turn-<person>-<pose>.jpg`). */
export function selfieStill(person: 'a' | 'b', pose: 'center' | 'left' | 'right'): string {
  return path.join(SELFIE, `head-turn-${person}-${pose}.jpg`);
}

/** A side of a C36 variant (`fixtures/generated/variants/`, indexed by `variants.json`). */
export function variantImage(name: string, side: 'front' | 'back'): string {
  return path.join(GENERATED, 'variants', `${name}-${side}.jpg`);
}

/** A file of the C65.2 proof-of-address set, or a sidecar (`fixtures/generated/poa/<path>`). */
export function poaFixture(relative: string): string {
  return path.join(GENERATED, 'poa', relative);
}

const NFC = path.join(GENERATED, 'nfc');

/** The C65.3 chip inputs: the TD3 data page, its MRZ record and person A's DG2 portrait. */
export const NFC_FIXTURES = {
  td3Page: path.join(NFC, 'td3-passport.jpg'),
  td3Record: path.join(NFC, 'td3-passport.json'),
  portrait: path.join(NFC, 'person-a-portrait.jp2'),
} as const;

/** The proof-of-address files the 5B spec uploads, with the sidecar it prefills from. */
const POA_INPUTS = [
  'en/utility-bill/happy.pdf',
  'en/utility-bill/happy.json',
  'en/utility-bill/too-old.pdf',
  'en/utility-bill/edited-covered-amount.pdf',
] as const;

/**
 * Every generated file a spec reads (C36, C65.2, C65.3); the global setup generates the set again
 * when one is missing.
 */
export function generatedInputs(): readonly string[] {
  return [
    FIXTURES.idFront,
    FIXTURES.idBack,
    FIXTURES.headTurnMatching,
    FIXTURES.headTurnDifferent,
    FIXTURES.staticReplay,
    ...(['a', 'b'] as const).flatMap((person) =>
      (['center', 'left', 'right'] as const).map((pose) => selfieStill(person, pose)),
    ),
    ...POA_INPUTS.map((relative) => poaFixture(relative)),
    ...Object.values(NFC_FIXTURES),
  ];
}
