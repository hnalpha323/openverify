/**
 * C52.6, C52.8, C54.1, C55.6, C55.10: the hooks a phone and an email verification share, which
 * their files under `services/{attributes,submit,sub-resources,publish}/` bind to their type.
 */
import { toTimestamp } from '@openverify/contracts';
import {
  closeOpenOtpChallenges,
  getOtpVerificationState,
  listOtpChallenges,
} from '@openverify/db';
import { Phase5ProblemError } from '../../errors.js';
import type { VerificationAttributeHook } from '../attributes/index.js';
import type { PublishHook, PublishHookProblem } from '../publish/index.js';
import type { SubmitGuard } from '../submit/index.js';
import { standardSubmitGuard } from '../submit/standard.js';
import type { SubResourceHook } from '../sub-resources/index.js';
import { loadOtpEvidence } from './evidence.js';
import { outOfCodes } from './state.js';

/**
 * C52.8: the destination under `member` (`phone-number` or `email-address`, PII), when its code
 * was confirmed, the accepted sends and the wrong entries.
 */
export function otpAttributeHook(member: 'phone-number' | 'email-address'): VerificationAttributeHook {
  return {
    async load(db, verification) {
      const evidence = await loadOtpEvidence(db, verification.environmentId, verification.id);
      return {
        [member]: evidence.destination,
        'confirmed-at':
          evidence.confirmed?.confirmedAt == null ? null : toTimestamp(evidence.confirmed.confirmedAt),
        sends: evidence.state?.sends ?? 0,
        'failed-attempts': evidence.state?.wrongEntries ?? 0,
      };
    },
    mask: (attributes, mask) => mask.attributes(attributes),
  };
}

/**
 * C52.6, C55.6: a confirmed code submits; an unconfirmed one only once a limit refused the user
 * (the check then answers `otp_delivery_unavailable`) or no code and no send is left (it fails
 * `otp_not_confirmed`, so the user can start again). The open code is closed with the submit.
 */
export function otpSubmitGuard(): SubmitGuard {
  const standard = standardSubmitGuard({ statuses: ['initiated', 'confirmed'] });
  return {
    ...standard,
    async inTransaction(ctx) {
      const prepared = await standard.inTransaction(ctx);
      const { environmentId, id } = ctx.verification;
      if (ctx.verification.status === 'initiated') {
        const state = await getOtpVerificationState(ctx.tx, environmentId, id);
        const challenges = await listOtpChallenges(ctx.tx, environmentId, id);
        if (state?.limitedAt == null && !outOfCodes(challenges, state, ctx.now)) {
          throw new Phase5ProblemError(
            'otp_not_confirmed',
            'The code was not confirmed yet; confirm it, or ask for a new one.',
          );
        }
      }
      await closeOpenOtpChallenges(ctx.tx, environmentId, id, 'superseded');
      return prepared;
    },
  };
}

/** C54.1: a canceled verification's open code is closed; nothing is staged or deleted. */
export const otpSubResources: SubResourceHook = {
  async onVerificationCanceled(tx, _events, verification) {
    await closeOpenOtpChallenges(tx, verification.environmentId, verification.id, 'superseded');
    return { staged: [], storageKeys: [] };
  },
};

/**
 * C55.10: publishing a `stepType` step needs its channel for the environment's kind: an SMS
 * sender bound for a phone step, a configured mailer for an email step.
 */
export function otpChannelPublish(stepType: 'phone_otp' | 'email_otp'): PublishHook {
  return {
    problems(ctx) {
      const bound =
        stepType === 'phone_otp'
          ? ctx.deps.providers[ctx.environment.kind].sms !== undefined
          : ctx.deps.mailer.configured;
      const problems: PublishHookProblem[] = bound
        ? []
        : ctx.flow.steps.flatMap((step, index) =>
            step.type === stepType
              ? [
                  {
                    code: 'otp_channel_not_configured' as const,
                    pointer: `/flow/steps/${String(index)}`,
                    detail:
                      stepType === 'phone_otp'
                        ? `No SMS sender is configured for ${ctx.environment.kind} environments.`
                        : 'No mail server is configured, so no email code can be sent.',
                  },
                ]
              : [],
          );
      return Promise.resolve(problems);
    },
  };
}
