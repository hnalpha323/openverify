/**
 * C54.1, C56: the `phone_number` job: `phone_number_otp_comparison` judged on the stored codes and
 * counts (`services/otp/evidence.ts`): a confirmed code passes, naming the sender that delivered
 * it. The verification writes no row of its own in the decision, so only its event is staged.
 */
import { evaluatePhoneNumberChecks } from '@openverify/checks';
import { loadOtpEvidence, otpCheckStateOf } from '../../services/otp/evidence.js';
import type { VerificationTypeJob } from './index.js';

export const phoneNumberJob: VerificationTypeJob<null> = {
  type: 'phone_number',
  runnable: true,
  async evaluate(deps, job) {
    const evidence = await loadOtpEvidence(deps.db, job.environmentId, job.verificationId);
    return {
      results: evaluatePhoneNumberChecks(
        {
          phoneNumber: evidence.destination,
          otp: otpCheckStateOf(evidence),
          sender: evidence.sender,
        },
        job.config,
      ),
      state: null,
    };
  },
  persistInDecisionTx: (_tx, ctx) => ctx.verificationEvent(),
  onProcessingFailed: () => Promise.resolve([]),
};
