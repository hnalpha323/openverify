import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACTS_DIR,
  E2E_DIR,
  ENV_FILE,
  FIXTURES,
  NFC_FIXTURES,
  REPO_ROOT,
  generatedInputs,
  poaFixture,
  selfieStill,
  variantImage,
} from './paths.js';

describe('paths', () => {
  it('locates the repository and this package from the source file', () => {
    expect(existsSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(E2E_DIR).toBe(path.join(REPO_ROOT, 'e2e'));
  });

  it('keeps generated files inside the gitignored parts of e2e/', () => {
    expect(ENV_FILE).toBe(path.join(E2E_DIR, '.env.e2e'));
    expect(ARTIFACTS_DIR).toBe(path.join(E2E_DIR, '.artifacts'));
  });

  it('names the synthetic ID, the C45.2 head-turn and static-replay clips and the default template', () => {
    const generated = path.join(REPO_ROOT, 'fixtures', 'generated');
    const selfie = path.join(generated, 'selfie');

    expect(FIXTURES).toEqual({
      idFront: path.join(generated, 'id-front.jpg'),
      idBack: path.join(generated, 'id-back.jpg'),
      headTurnMatching: path.join(selfie, 'head-turn-a.mjpeg'),
      headTurnDifferent: path.join(selfie, 'head-turn-b.mjpeg'),
      staticReplay: path.join(selfie, 'static-replay-a.mjpeg'),
      generatorStamp: path.join(generated, '.generator-version'),
      defaultTemplate: path.join(
        REPO_ROOT,
        'contracts',
        'fixtures',
        'flows',
        'default-gov-id-selfie.json',
      ),
    });
    expect(existsSync(FIXTURES.defaultTemplate)).toBe(true);
  });

  it('names a pose of a C45.2 still triple as the generator writes it', () => {
    const selfie = path.join(REPO_ROOT, 'fixtures', 'generated', 'selfie');

    expect(selfieStill('a', 'center')).toBe(path.join(selfie, 'head-turn-a-center.jpg'));
    expect(selfieStill('b', 'right')).toBe(path.join(selfie, 'head-turn-b-right.jpg'));
  });

  it('names a side of a C36 variant as the generator writes it', () => {
    const variants = path.join(REPO_ROOT, 'fixtures', 'generated', 'variants');

    expect(variantImage('expired', 'front')).toBe(path.join(variants, 'expired-front.jpg'));
    expect(variantImage('specimen-stamped', 'back')).toBe(
      path.join(variants, 'specimen-stamped-back.jpg'),
    );
  });

  it('names the proof-of-address files and the chip inputs as fixtures-5b writes them (C65.2, C65.3)', () => {
    const generated = path.join(REPO_ROOT, 'fixtures', 'generated');

    expect(poaFixture('en/utility-bill/happy.pdf')).toBe(
      path.join(generated, 'poa', 'en', 'utility-bill', 'happy.pdf'),
    );
    expect(NFC_FIXTURES).toEqual({
      td3Page: path.join(generated, 'nfc', 'td3-passport.jpg'),
      td3Record: path.join(generated, 'nfc', 'td3-passport.json'),
      portrait: path.join(generated, 'nfc', 'person-a-portrait.jp2'),
    });
  });

  it('lists every generated file a spec reads, so a missing one generates the set again', () => {
    const inputs = generatedInputs();

    expect(inputs).toEqual(
      expect.arrayContaining([
        FIXTURES.idFront,
        FIXTURES.idBack,
        FIXTURES.headTurnMatching,
        FIXTURES.headTurnDifferent,
        FIXTURES.staticReplay,
        selfieStill('a', 'center'),
        selfieStill('a', 'left'),
        selfieStill('a', 'right'),
        selfieStill('b', 'center'),
        poaFixture('en/utility-bill/happy.pdf'),
        poaFixture('en/utility-bill/happy.json'),
        poaFixture('en/utility-bill/too-old.pdf'),
        poaFixture('en/utility-bill/edited-covered-amount.pdf'),
        NFC_FIXTURES.td3Page,
        NFC_FIXTURES.td3Record,
        NFC_FIXTURES.portrait,
      ]),
    );
    expect(new Set(inputs).size).toBe(inputs.length);
  });
});
