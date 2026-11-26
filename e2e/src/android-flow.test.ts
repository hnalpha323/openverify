import { readFileSync, writeFileSync } from 'node:fs';
import { createInquiryTemplateAttributesSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_FLOW_DATABASE_FIELDS,
  ANDROID_FLOW_FILE,
  ANDROID_FLOW_STEPS,
  androidFlowFixture,
} from './android-flow.js';

/**
 * C224.3, C224.4, rule 21: the committed `fixtures/android-10a/flow.json` is what the builder
 * produces, so the Kotlin `stackTest` and the API-driven spec drive the same flow. A plain run
 * never writes; `UPDATE_CONTRACT_FIXTURES=1` writes the file (then run Prettier over it).
 */
describe('the 10A flow fixture', () => {
  const built = androidFlowFixture();

  it('is the committed file', () => {
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(ANDROID_FLOW_FILE, `${JSON.stringify(built, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(ANDROID_FLOW_FILE, 'utf8'))).toEqual(built);
  });

  it('creates a template the API accepts, then drafts the v2 flow with its own members', () => {
    expect(
      createInquiryTemplateAttributesSchema.safeParse({ ...built.template, name: 'e2e android' })
        .success,
    ).toBe(true);
    const flow = built.version.flow as {
      metadata: { specVersion: number };
      steps: { id: string; type: string; fields?: string[] }[];
    };
    expect(flow.metadata.specVersion).toBe(2);
    expect(flow.steps.map((step) => step.id)).toEqual(Object.values(ANDROID_FLOW_STEPS));
    expect(flow.steps.find((step) => step.type === 'database')?.fields).toEqual([
      ...ANDROID_FLOW_DATABASE_FIELDS,
    ]);
    expect(built.version['enabled-locales']).toEqual(['en', 'es']);
    expect(built.template).not.toHaveProperty('name');
  });
});
