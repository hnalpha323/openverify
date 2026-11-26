/**
 * C52.2, C54.1: the `document` verification's flow view. `guidance` tells the client what to ask
 * for, from the inquiry's pinned step and template version:
 * - `accepted-types`: the classes the step accepts (`documentTypes`);
 * - `max-age-days`: the window `document_recency_detection` judges a bill, statement or pay stub
 *   by, as the template configures it, else its provisional default (90; C51.3); leases and tax
 *   documents follow their own rules (C60.6), which the clients state;
 * - `max-pages`: the most pages vision reads (50, C60.1);
 * - `accepted-mime-types`: the images and PDF when the step takes uploads, the images alone when
 *   it takes camera photos only (a camera makes no PDF; the upload route still types every file by
 *   its content, C52.4).
 *
 * `null` without a document step. A flow view never carries a value or a check.
 */
import { ACCEPTED_IMAGE_MIME_TYPES, DOCUMENT_MIME_TYPES } from '@openverify/contracts';
import {
  documentRecencyDetectionConfigSchema,
  phase5ConfigDefaults,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { MAX_DOCUMENT_PAGES } from '../../vision/schemas.js';
import type { VerificationGuidanceHook } from './index.js';

/** The recency check's provisional default window (C51.3). */
function defaultMaxAgeDays(): number {
  const value = phase5ConfigDefaults('document_recency_detection')['max-age-days'];
  if (typeof value !== 'number') {
    throw new Error('document_recency_detection has no max-age-days default');
  }
  return value;
}

/** The window the template judges by: its configured `max-age-days`, else the default. */
export function documentRecencyWindow(config: VerificationTemplateConfig | undefined): number {
  const configured = documentRecencyDetectionConfigSchema.safeParse(
    config?.checks.document_recency_detection?.config ?? {},
  );
  return (configured.success ? configured.data['max-age-days'] : undefined) ?? defaultMaxAgeDays();
}

export const documentGuidance: VerificationGuidanceHook = {
  flowAttributes({ step, config }) {
    if (step?.type !== 'document') {
      return Promise.resolve({ guidance: null });
    }
    return Promise.resolve({
      guidance: {
        'accepted-types': [...step.documentTypes],
        'max-age-days': documentRecencyWindow(config),
        'max-pages': MAX_DOCUMENT_PAGES,
        'accepted-mime-types': step.captureMethods.includes('upload')
          ? [...DOCUMENT_MIME_TYPES]
          : [...ACCEPTED_IMAGE_MIME_TYPES],
      },
    });
  },
};
