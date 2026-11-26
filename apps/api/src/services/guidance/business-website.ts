/**
 * C52.2, C54.1: the `business-website` verification's flow view: the step needs no guidance (an
 * empty object, Stage 1a decision 7), and `inputs-received` says whether the URL was entered.
 * Never a value.
 */
import { getVerificationInputs } from '@openverify/db';
import type { VerificationGuidanceHook } from './index.js';

export const businessWebsiteGuidance: VerificationGuidanceHook = {
  async flowAttributes({ db, verification, step }) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    return {
      guidance: step?.type === 'business_website' ? {} : null,
      'inputs-received': inputs !== null,
    };
  },
};
