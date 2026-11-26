import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInquiryTemplateAttributesSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_NFC_FLOW_FILE,
  ANDROID_NFC_FLOW_STEPS,
  androidNfcFlowFixture,
} from './android-nfc-flow.js';
import { ANDROID_FLOW_FILE } from './android-flow.js';
import { NFC_FIXTURES, poaFixture, REPO_ROOT, selfieStill } from './paths.js';

/**
 * C224.3, C224.4, rule 27: the committed `fixtures/android-10c/flow.json` is what the builder
 * produces, so the Kotlin `stackTest` and the API-driven spec drive the same flow. A plain run
 * never writes; `UPDATE_CONTRACT_FIXTURES=1` writes the file (then run Prettier over it).
 */
describe('the 10C flow fixture', () => {
  const built = androidNfcFlowFixture();

  it('is the committed file, beside the 10A one', () => {
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(ANDROID_NFC_FLOW_FILE, `${JSON.stringify(built, null, 2)}\n`);
    }
    expect(existsSync(ANDROID_NFC_FLOW_FILE)).toBe(true);
    expect(JSON.parse(readFileSync(ANDROID_NFC_FLOW_FILE, 'utf8'))).toEqual(built);
    expect(path.dirname(ANDROID_NFC_FLOW_FILE)).not.toBe(path.dirname(ANDROID_FLOW_FILE));
  });

  it('is a flow-spec 2 flow: consent with both integrity notices, a one-sided ID, a selfie, the chip, and a document on its exhausted edge', () => {
    expect(
      createInquiryTemplateAttributesSchema.safeParse({ ...built.template, name: 'e2e nfc' })
        .success,
    ).toBe(true);
    expect(built.template).not.toHaveProperty('name');
    const flow = built.version.flow as {
      metadata: { specVersion: number };
      steps: { id: string; type: string; textKeys?: string[]; sides?: string }[];
      edges: { from: string; port: string; to: string }[];
    };
    expect(flow.metadata.specVersion).toBe(2);
    const ids = ANDROID_NFC_FLOW_STEPS;
    expect(flow.steps.map((step) => [step.id, step.type])).toEqual([
      [ids.consent, 'consent'],
      [ids.idCard, 'government_id'],
      [ids.face, 'selfie'],
      [ids.chip, 'nfc'],
      [ids.papers, 'document'],
      [ids.done, 'completion'],
    ]);
    expect(flow.steps[0]?.textKeys).toEqual(
      expect.arrayContaining(['notice.session-integrity', 'notice.play-integrity']),
    );
    expect(flow.steps.find((step) => step.id === ids.idCard)).toMatchObject({ sides: 'front' });
    expect(flow.edges.map((edge) => [edge.from, edge.port, edge.to])).toEqual([
      [ids.consent, 'next', ids.idCard],
      [ids.idCard, 'next', ids.face],
      [ids.face, 'next', ids.chip],
      [ids.chip, 'next', ids.done],
      [ids.chip, 'exhausted', ids.papers],
      [ids.papers, 'next', ids.done],
    ]);
    // Uploaded stills cannot be judged live, so liveness is advisory here and nowhere else.
    const config = built.version['verification-config'] as {
      selfie: { checks: Record<string, { enabled: boolean; required: boolean }> };
    };
    expect(config.selfie.checks.selfie_liveness_detection).toEqual({
      enabled: true,
      required: false,
    });
    expect(Object.keys(built.version['verification-config'] as object).sort()).toEqual([
      'document',
      'government-id',
      'government-id-nfc',
      'selfie',
    ]);
  });

  it('names the generated inputs from the repository root and the holder they share', () => {
    const absolute = (relative: string) => path.join(REPO_ROOT, relative);
    expect(absolute(built.inputs['id-front'])).toBe(NFC_FIXTURES.td3Page);
    expect(absolute(built.inputs.selfie.center)).toBe(selfieStill('a', 'center'));
    expect(absolute(built.inputs.selfie.left)).toBe(selfieStill('a', 'left'));
    expect(absolute(built.inputs.selfie.right)).toBe(selfieStill('a', 'right'));
    expect(absolute(built.inputs.document)).toBe(poaFixture('en/utility-bill/happy.pdf'));
    expect(built['inquiry-fields']).toMatchObject({ name_first: 'Nora', name_last: 'Calderwood' });
    // Paths only: no image, MRZ or chip byte is in the fixture.
    expect(JSON.stringify(built)).not.toMatch(/P<UTO|base64|\/home\//);
  });
});
