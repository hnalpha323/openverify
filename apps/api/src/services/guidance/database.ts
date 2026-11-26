/**
 * C52.2, C54.1: the `database` verification's flow view: `guidance` names the body members the
 * pinned step collects (`fields`) and the ones a body must carry (`required-fields`,
 * `services/inputs/database.ts`), and `inputs-received` says whether the values were entered.
 * Never a value.
 */
import { getVerificationInputs } from '@openverify/db';
import { databaseCollectedInputs, databaseRequiredInputs } from '../inputs/database.js';
import type { VerificationGuidanceHook } from './index.js';

export const databaseGuidance: VerificationGuidanceHook = {
  async flowAttributes({ db, verification, step }) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    return {
      guidance:
        step?.type === 'database'
          ? {
              fields: databaseCollectedInputs(step),
              'required-fields': databaseRequiredInputs(step),
            }
          : null,
      'inputs-received': inputs !== null,
    };
  },
};
