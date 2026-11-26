/**
 * C54.1, C56: the `phone_number` job judges `phone_number_otp_comparison` on the stored codes and
 * counts: a confirmed code passes (provenance names the sender), ten wrong entries or every send
 * used without a confirmation fail as user behaviour (the user may start again), a limit refusal
 * goes to review (`otp_delivery_unavailable`), and no evidence is `input_missing`. No number in a
 * result. Every number is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contactJobDatabase,
  contactJobDeps,
  decided,
  submittedOtpVerification,
  type ContactJobDatabase,
  type OtpRows,
} from '../../contact/job-testing.js';
import { failVerificationAfterError, processVerification } from '../process-verification.js';
import { isRunnableVerificationType, verificationTypeJob } from './index.js';

const NUMBER = '+12025550100';

let fixture: ContactJobDatabase;

beforeAll(async () => {
  fixture = await contactJobDatabase();
}, 60_000);

afterAll(async () => {
  await fixture.database.close();
});

async function judged(rows: Partial<OtpRows> = {}) {
  const { verificationId } = await submittedOtpVerification(
    fixture,
    fixture.sandboxId,
    'phone_number',
    {
      destination: NUMBER,
      ...rows,
    },
  );
  const outcome = await processVerification(
    { environmentId: fixture.sandboxId, verificationId },
    contactJobDeps(fixture),
  );
  const verification = await decided(fixture, fixture.sandboxId, verificationId);
  const check = verification.checks.find((result) => result.name === 'phone_number_otp_comparison');
  return { outcome, verification, check };
}

describe('the phone_number job (C56)', () => {
  it('is built and runnable', () => {
    expect(isRunnableVerificationType('phone_number')).toBe(true);
    expect(verificationTypeJob('phone_number').type).toBe('phone_number');
  });

  it('passes a confirmed code, naming the sandbox sender', async () => {
    const { outcome, check, verification } = await judged();

    expect(outcome).toMatchObject({ outcome: 'processed', verificationStatus: 'passed' });
    expect(check).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { channel: 'sms', sends: 1, 'failed-attempts': 0 },
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect(JSON.stringify(verification.checks)).not.toContain('2025550100');
  });

  it('fails ten wrong entries as otp_attempts_exhausted, which the user may retry', async () => {
    const { outcome, check } = await judged({ status: 'exhausted', wrongEntries: 10 });

    expect(outcome).toMatchObject({ verificationStatus: 'failed' });
    expect(check).toMatchObject({
      status: 'failed',
      type: 'user_behavior',
      reasons: ['otp_attempts_exhausted'],
    });
  });

  it('fails every send used without a confirmation as otp_not_confirmed', async () => {
    const { check } = await judged({ status: 'expired', sends: 5 });

    expect(check).toMatchObject({ status: 'failed', reasons: ['otp_not_confirmed'] });
  });

  it('sends a limit refusal to review as otp_delivery_unavailable', async () => {
    const { outcome, check } = await judged({
      status: 'sent',
      limitedReason: 'destination',
    });

    expect(outcome).toMatchObject({ verificationStatus: 'needs_review' });
    expect(check).toMatchObject({
      status: 'not_applicable',
      reasons: ['otp_delivery_unavailable'],
      metadata: { 'limited-reason': 'destination' },
    });
  });

  it('answers input_missing without any code or count', async () => {
    const { check, outcome } = await judged({ noChallenge: true, noState: true });

    expect(outcome).toMatchObject({ verificationStatus: 'needs_review' });
    expect(check).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
  });

  it('names the real sender of the code it judged', async () => {
    const { check } = await judged({ provider: 'twilio' });

    expect(check?.provenance).toMatchObject({ provider: { id: 'twilio', sandbox: false } });
  });

  it('fails a verification whose processing cannot finish, staging nothing of its own', async () => {
    const { verificationId } = await submittedOtpVerification(
      fixture,
      fixture.sandboxId,
      'phone_number',
      { destination: NUMBER },
    );

    const failed = await failVerificationAfterError(
      { environmentId: fixture.sandboxId, verificationId },
      contactJobDeps(fixture),
      'synthetic_failure',
    );

    expect(failed).toMatchObject({ outcome: 'failed' });
    expect((await decided(fixture, fixture.sandboxId, verificationId)).status).toBe('failed');
  });
});
