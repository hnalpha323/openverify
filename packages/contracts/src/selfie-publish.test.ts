/**
 * C40.2: a selfie step prompts `center` first, so publishing a template version whose selfie
 * step lacks it fails; stored versions without it still parse.
 */
import { describe, expect, it } from 'vitest';
import {
  createInquiryTemplateAttributesSchema,
  defaultInquiryTemplateAttributes,
  inquiryTemplateVersionSchema,
} from './inquiry-templates.js';
import { createInquiryTemplateVersionBodySchema } from './inquiry-template-versions.js';

function withSelfie(poses: string[], liveness: 'active' | 'passive') {
  const template = defaultInquiryTemplateAttributes() as unknown as {
    flow: { steps: Record<string, unknown>[] };
  };
  const steps = template.flow.steps.map((step) =>
    step.type === 'selfie' ? { ...step, poses, liveness } : step,
  );
  return { ...template, flow: { ...template.flow, steps } };
}

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('the centre rule at publish time (C40.2)', () => {
  it('refuses a new template whose selfie step does not prompt center', () => {
    const result = createInquiryTemplateAttributesSchema.safeParse(
      withSelfie(['left', 'right'], 'active'),
    );
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([expect.stringMatching(/^flow\.steps\.2\.poses: .*center/)]);
  });

  it('refuses a new version whose selfie step does not prompt center', () => {
    const { flow, 'verification-config': config } = withSelfie(['left'], 'active') as unknown as {
      flow: unknown;
      'verification-config': unknown;
    };
    const result = createInquiryTemplateVersionBodySchema.safeParse({
      data: {
        type: 'inquiry-template-version',
        attributes: {
          'inquiry-template-id': 'itmpl_01M5CJXHG07XPHF3HRM6NREDH7',
          flow,
          'verification-config': config,
        },
      },
    });
    expect(issues(result)).toEqual([
      expect.stringMatching(/^data\.attributes\.flow\.steps\.2\.poses: .*center/),
    ]);
  });

  it('accepts center with or without side poses', () => {
    expect(
      createInquiryTemplateAttributesSchema.safeParse(withSelfie(['center'], 'passive')).success,
    ).toBe(true);
    expect(
      createInquiryTemplateAttributesSchema.safeParse(
        withSelfie(['center', 'right', 'left'], 'active'),
      ).success,
    ).toBe(true);
  });

  it('still reads a stored version without center', () => {
    const stored = withSelfie(['left', 'right'], 'active') as unknown as Record<string, unknown>;
    const version = {
      id: 'itmplv_01M5CJXHG07XPHF3HRM6NREDH7',
      'version-number': 1,
      flow: stored.flow,
      'verification-config': stored['verification-config'],
      'created-at': '2026-10-21T12:00:00.000Z',
    };
    expect(inquiryTemplateVersionSchema.safeParse(version).success).toBe(true);
  });
});
