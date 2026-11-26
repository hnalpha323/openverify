/**
 * C62.5, C52.6: the `government-id-nfc` submit. The body carries `{ chip: { challenge-id, nonce,
 * active-authentication-response?, device-report? } }` and nothing else. Under the C40.6 locks
 * (the inquiry, the verification, then the challenge):
 *
 * 1. the step's files are stored (`chip-sod`, `chip-dg1`, `chip-dg2`; 422 otherwise);
 * 2. the SOD is parsed (bounded, `@openverify/emrtd`), and every data group it lists among 1, 2,
 *    14 and 15 must be uploaded (409 `chip_data_required`): a client cannot withhold DG15 and its
 *    AA response unnoticed. A SOD that cannot be read is left to the job, whose passive
 *    authentication answers `chip_data_malformed` (review), never a pass;
 * 3. the named challenge is consumed once by a conditional update with the nonce the client
 *    echoes (its SHA-256 must be the stored one), sealing the AA response with that nonce and the
 *    device report. Every refusal of the challenge, a missing `chip` member included, answers one
 *    409 `chip_challenge_invalid` body.
 *
 * A repeated submit of a `submitted` verification must name the challenge that submitted it. The
 * device report is shown to operators only, never evidence.
 */
import { consumeChipChallenge, getChipChallenge } from '@openverify/db';
import { EmrtdError, TAKEN_DATA_GROUPS, parseSod, type DataGroupNumber } from '@openverify/emrtd';
import {
  CHIP_DATA_GROUP_KINDS,
  latestChipFile,
  readChipFile,
} from '../chip-challenges/chip-files.js';
import {
  chipChallengeInvalid,
  chipDataRequired,
  chipNonceSha256,
} from '../chip-challenges/rules.js';
import type { SubmitContext, SubmitGuard } from './index.js';
import { assertOnlyMember, assertRequiredFiles } from './standard.js';

/** The data groups the SOD lists among those Phase 5 takes; `null` when it cannot be read. */
async function listedDataGroups(ctx: SubmitContext): Promise<DataGroupNumber[] | null> {
  const file = latestChipFile(ctx.files, 'chip-sod');
  if (file === undefined) {
    return null;
  }
  const bytes = await readChipFile(ctx.deps, file);
  try {
    return parseSod(bytes).listedDataGroups.filter((group) => TAKEN_DATA_GROUPS.includes(group));
  } catch (error) {
    if (error instanceof EmrtdError) {
      return null;
    }
    throw error;
  } finally {
    bytes.fill(0);
  }
}

export const governmentIdNfcSubmit: SubmitGuard = {
  submittableStatuses: ['initiated'],
  checkBody(ctx) {
    assertOnlyMember(ctx, 'chip');
    if (ctx.body?.chip === undefined) {
      throw chipChallengeInvalid();
    }
  },
  async inTransaction(ctx) {
    const submitted = ctx.body?.chip;
    if (submitted === undefined) {
      throw chipChallengeInvalid();
    }
    assertRequiredFiles(ctx);
    const listed = (await listedDataGroups(ctx)) ?? [];
    const missing = listed.filter(
      (group) =>
        latestChipFile(
          ctx.files,
          CHIP_DATA_GROUP_KINDS[group as keyof typeof CHIP_DATA_GROUP_KINDS],
        ) === undefined,
    );
    if (missing.length > 0) {
      throw chipDataRequired();
    }
    const deviceReport = submitted['device-report'];
    const consumed = await consumeChipChallenge(ctx.tx, ctx.verification.environmentId, {
      id: submitted['challenge-id'],
      verificationId: ctx.verification.id,
      nonceSha256: chipNonceSha256(submitted.nonce),
      now: ctx.now,
      submission: {
        nonce: submitted.nonce,
        aaResponse: submitted['active-authentication-response'] ?? null,
        deviceReport: deviceReport === undefined ? null : JSON.stringify(deviceReport),
      },
    });
    if (consumed === null) {
      throw chipChallengeInvalid();
    }
    return { files: ctx.files, staged: [] };
  },
  async repeat({ deps, verification, body }) {
    const submitted = body?.chip;
    const challenge =
      submitted === undefined
        ? null
        : await getChipChallenge(deps.db, verification.environmentId, submitted['challenge-id']);
    // C3: only the challenge that submitted the verification repeats its submit.
    if (
      challenge?.verificationId !== verification.id ||
      (challenge.status !== 'submitted' && challenge.status !== 'processed')
    ) {
      throw chipChallengeInvalid();
    }
  },
};
