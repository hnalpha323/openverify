import { describe, expect, it } from 'vitest';
import {
  installWorkflowRecipeBodySchema,
  workflowActionAttributesSchema,
  workflowActionIdSchema,
  workflowActionResourceSchema,
  workflowRecipeKeySchema,
} from './workflow-actions.js';

const attributes = {
  key: 'send_slack_message',
  version: 1,
  kind: 'egress',
  stage: 'ga',
  delivery: 'at-most-once',
  adverse: 'never',
  'config-schema': { type: 'object' },
  'output-schema': { type: 'object' },
  grant: { scopes: [], pii: false },
  'grant-depends-on-config': true,
  emits: [],
  triggers: null,
  available: true,
  reason: null,
};

describe('the action catalogue (C122.4, C122.5)', () => {
  it('serves one action version by key and version', () => {
    const resource = {
      type: 'workflow-action',
      id: 'send_slack_message@1',
      attributes,
    };
    expect(workflowActionResourceSchema.parse(resource)).toEqual(resource);
    expect(workflowActionIdSchema.safeParse('send_slack_message').success).toBe(false);
    expect(workflowActionIdSchema.safeParse('Send@1').success).toBe(false);
    expect(workflowActionIdSchema.safeParse('send@0').success).toBe(false);
  });

  it('is unavailable exactly when it says why', () => {
    const parse = (value: object) =>
      workflowActionAttributesSchema.safeParse({ ...attributes, ...value }).success;
    expect(parse({ available: false, reason: 'provider_not_configured' })).toBe(true);
    expect(parse({ available: false, reason: 'code_disabled' })).toBe(true);
    expect(parse({ available: false })).toBe(false);
    expect(parse({ reason: 'provider_not_configured' })).toBe(false);
    expect(parse({ available: false, reason: 'other' })).toBe(false);
  });

  it('refuses a grant that holds an operator permission (C121.2)', () => {
    expect(
      workflowActionAttributesSchema.safeParse({
        ...attributes,
        grant: { scopes: ['pii:view'], pii: true },
      }).success,
    ).toBe(false);
  });
});

describe('the recipes (C140.5)', () => {
  it('keys a recipe in kebab-case, because it is a path segment', () => {
    expect(workflowRecipeKeySchema.safeParse('review-on-report-match').success).toBe(true);
    expect(workflowRecipeKeySchema.safeParse('Review/Match').success).toBe(false);
  });

  it('installs with no parameters', () => {
    expect(installWorkflowRecipeBodySchema.safeParse(undefined).success).toBe(true);
    expect(installWorkflowRecipeBodySchema.safeParse({ meta: { enable: true } }).success).toBe(
      false,
    );
  });
});
