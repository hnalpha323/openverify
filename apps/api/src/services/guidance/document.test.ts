/**
 * C52.2, C54.1: the `document` verification's flow view. `guidance` names the classes the pinned
 * step accepts, the recency window the template judges by (`document_recency_detection`'s
 * `max-age-days`, its provisional default 90 when not set), the page limit vision reads (50,
 * C60.1) and the media types a client may send: images and PDF when the step takes uploads, the
 * images alone when it takes camera photos only (a camera makes no PDF). `null` without a
 * document step. Never a value.
 */
import { documentGuidanceSchema } from '@openverify/contracts';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';
import type { FlowStep } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import type { FlowGuidanceContext } from './index.js';
import { documentGuidance } from './document.js';

const STEP: FlowStep = {
  id: 'proof-of-address',
  type: 'document',
  documentTypes: ['utility_bill', 'bank_statement'],
  captureMethods: ['upload', 'camera'],
};

function context(
  step: FlowStep | undefined,
  config: VerificationTemplateConfig | undefined = defaultTemplateConfig('document'),
): FlowGuidanceContext {
  return { deps: {} as never, db: {} as never, verification: {} as never, step, config };
}

/** The template's recency check with `config`. */
function withRecency(config: Record<string, unknown>): VerificationTemplateConfig {
  const template = defaultTemplateConfig('document');
  return {
    ...template,
    checks: {
      ...template.checks,
      document_recency_detection: { enabled: true, required: true, config },
    },
  };
}

describe('documentGuidance (C52.2)', () => {
  it('names the accepted classes, the 90-day default window, the page limit and every media type', async () => {
    const attributes = await documentGuidance.flowAttributes(context(STEP));

    expect(attributes).toEqual({
      guidance: {
        'accepted-types': ['utility_bill', 'bank_statement'],
        'max-age-days': 90,
        'max-pages': 50,
        'accepted-mime-types': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      },
    });
    expect(documentGuidanceSchema.safeParse(attributes.guidance).success).toBe(true);
  });

  it('sends the window the template configures', async () => {
    const attributes = await documentGuidance.flowAttributes(
      context(STEP, withRecency({ 'max-age-days': 365 })),
    );

    expect(attributes.guidance).toMatchObject({ 'max-age-days': 365 });
  });

  it('keeps the default window for a template without the type or with a value its schema refuses', async () => {
    const none = await documentGuidance.flowAttributes(context(STEP, undefined));
    const refused = await documentGuidance.flowAttributes(
      context(STEP, withRecency({ 'max-age-days': 0 })),
    );

    expect(none.guidance).toMatchObject({ 'max-age-days': 90 });
    expect(refused.guidance).toMatchObject({ 'max-age-days': 90 });
  });

  it('offers the image types alone to a step that takes camera photos only', async () => {
    const attributes = await documentGuidance.flowAttributes(
      context({ ...STEP, captureMethods: ['camera'] }),
    );

    expect(attributes.guidance).toMatchObject({
      'accepted-mime-types': ['image/jpeg', 'image/png', 'image/webp'],
    });
  });

  it('answers null without a document step', async () => {
    expect(await documentGuidance.flowAttributes(context(undefined))).toEqual({ guidance: null });
    expect(
      await documentGuidance.flowAttributes(
        context({
          id: 'selfie',
          type: 'selfie',
          poses: ['center'],
          liveness: 'passive',
          maxAttempts: 3,
        }),
      ),
    ).toEqual({ guidance: null });
  });
});
