/**
 * C52.2, C54.1, C59.6: the `aamva` verification's flow view: `guidance` names the pinned step's
 * source (`form`: the user fills the AAMVA form; `government_id`: the server reads the inquiry's
 * licence, and the client only waits), and `inputs-received` says whether the values were entered
 * or copied. Never a value.
 */
import { getVerificationInputs } from '@openverify/db';
import type { VerificationGuidanceHook } from './index.js';

export const aamvaGuidance: VerificationGuidanceHook = {
  async flowAttributes({ db, verification, step }) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    return {
      guidance: step?.type === 'aamva' ? { source: step.source } : null,
      'inputs-received': inputs !== null,
    };
  },
};
