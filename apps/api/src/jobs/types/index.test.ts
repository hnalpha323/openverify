import { SUPPORTED_VERIFICATION_TYPES } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from '../errors.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import {
  isRunnableVerificationType,
  verificationTypeJob,
  VERIFICATION_TYPE_JOBS,
} from './index.js';
import { unbuiltTypeJob } from './stub.js';

describe('the type jobs (C54.1)', () => {
  it('has one job per verification type, each naming its own type', () => {
    expect(Object.keys(VERIFICATION_TYPE_JOBS).sort()).toEqual(
      [...SUPPORTED_VERIFICATION_TYPES].sort(),
    );
    for (const type of SUPPORTED_VERIFICATION_TYPES) {
      expect(verificationTypeJob(type).type, type).toBe(type);
      expect(isRunnableVerificationType(type)).toBe(VERIFICATION_TYPE_JOBS[type].runnable);
    }
  });

  it('runs the government ID and selfie jobs, which moved behind the hooks unchanged', () => {
    expect(isRunnableVerificationType('government_id')).toBe(true);
    expect(isRunnableVerificationType('selfie')).toBe(true);
  });
});

describe('unbuiltTypeJob (C54.1)', () => {
  const job = unbuiltTypeJob('document');
  const deps = {} as ProcessVerificationDeps;
  const tx = {} as Db;

  it('is not runnable, so the flow refuses to create one and the job to judge one', () => {
    expect(job).toMatchObject({ type: 'document', runnable: false });
  });

  it('answers nothing: its evaluator refuses for good', async () => {
    const rejection = await job.evaluate(deps, {} as never).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(PermanentJobError);
    expect(rejection).toMatchObject({ reason: 'unsupported_verification' });
  });

  it('stages only the verification event in a decision and nothing when processing fails', async () => {
    const event = { eventId: 'evt_x', deliveries: [] };
    const verificationEvent = vi.fn(() => Promise.resolve([event]));

    await expect(job.persistInDecisionTx(tx, { verificationEvent } as never)).resolves.toEqual([
      event,
    ]);
    expect(verificationEvent).toHaveBeenCalledTimes(1);
    await expect(job.onProcessingFailed(tx, {} as never)).resolves.toEqual([]);
  });
});
