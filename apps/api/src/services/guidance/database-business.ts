/**
 * C52.2, C54.1: the `database-business` verification's flow view: `guidance` says whether the
 * pinned step collects associated persons and names the inputs every configured match group of
 * the identity check needs (`required-inputs`, `businessRequiredInputs`, the rule the inputs route
 * enforces), and `inputs-received` says whether the values were entered. Never a value.
 */
import { getVerificationInputs } from '@openverify/db';
import { businessRequiredInputs } from '../inputs/database-business.js';
import type { VerificationGuidanceHook } from './index.js';

export const databaseBusinessGuidance: VerificationGuidanceHook = {
  async flowAttributes({ db, verification, step, config }) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    return {
      guidance:
        step?.type === 'database_business'
          ? {
              'collect-associated-persons': step.collectAssociatedPersons === true,
              'required-inputs': businessRequiredInputs(config),
            }
          : null,
      'inputs-received': inputs !== null,
    };
  },
};
