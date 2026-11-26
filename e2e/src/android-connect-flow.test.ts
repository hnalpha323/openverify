import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInquiryTemplateAttributesSchema, sharePolicySchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { ANDROID_NFC_FLOW_FILE } from './android-nfc-flow.js';
import {
  ANDROID_CONNECT_FLOW_FILE,
  ANDROID_CONNECT_FLOW_STEPS,
  androidConnectFlowFixture,
} from './android-connect-flow.js';
import { REPO_ROOT } from './paths.js';

/**
 * C287.4, rule 24 (Workflow 11A integration-11a): the committed `fixtures/android-11a/flow.json` is
 * what the builder produces, so `AndroidConnectFlowStackTest` drives these flows. A plain run never
 * writes; `UPDATE_CONTRACT_FIXTURES=1` writes the file (then run Prettier over it).
 */
describe('the 11A client-side redemption fixture', () => {
  const built = androidConnectFlowFixture();

  it('is the committed file, in a folder of its own beside the 10A and 10C ones', () => {
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(ANDROID_CONNECT_FLOW_FILE, `${JSON.stringify(built, null, 2)}\n`);
    }
    expect(existsSync(ANDROID_CONNECT_FLOW_FILE)).toBe(true);
    expect(JSON.parse(readFileSync(ANDROID_CONNECT_FLOW_FILE, 'utf8'))).toEqual(built);
    expect(path.dirname(ANDROID_CONNECT_FLOW_FILE)).not.toBe(path.dirname(ANDROID_NFC_FLOW_FILE));
  });

  it('has a source-side share_consent naming no connection, and a destination-side one with a retention term', () => {
    const steps = (side: 'source' | 'destination') =>
      (built[side].version.flow as { steps: { id: string; type: string; side?: string }[] }).steps;
    const ids = ANDROID_CONNECT_FLOW_STEPS;
    expect(steps('source').map((step) => step.id)).toEqual([
      ids.consent,
      ids.idCard,
      ids.shareOut,
      ids.done,
    ]);
    expect(steps('source').find((step) => step.id === ids.shareOut)).toMatchObject({
      type: 'share_consent',
      side: 'source',
    });
    expect(JSON.stringify(built)).not.toContain('cxn_');
    expect(steps('destination').find((step) => step.id === ids.shareIn)).toMatchObject({
      type: 'share_consent',
      side: 'destination',
    });
    expect(built.destination.version.settings).toEqual({ 'retention-days': 365 });
  });

  it('shows notice.play-integrity wherever it shows notice.session-integrity (rule 7)', () => {
    for (const side of ['source', 'destination'] as const) {
      const consent = (
        built[side].version.flow as { steps: { type: string; textKeys?: string[] }[] }
      ).steps.find((step) => step.type === 'consent');
      expect(consent?.textKeys).toContain('notice.session-integrity');
      expect(consent?.textKeys).toContain('notice.play-integrity');
    }
  });

  it('carries a valid share policy and templates, and names a generated input that the stack makes', () => {
    expect(sharePolicySchema.safeParse(built['share-policy']).success).toBe(true);
    for (const side of ['source', 'destination'] as const) {
      expect(
        createInquiryTemplateAttributesSchema.safeParse({ ...built[side].template, name: 'x' })
          .success,
      ).toBe(true);
    }
    expect(built.inputs['id-front'].startsWith('fixtures/generated/')).toBe(true);
    expect(path.isAbsolute(built.inputs['id-front'])).toBe(false);
    expect(REPO_ROOT.length).toBeGreaterThan(0);
  });
});
