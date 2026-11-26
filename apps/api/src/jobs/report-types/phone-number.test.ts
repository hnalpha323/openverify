/**
 * C82.2: the `phone-number` report job over risk-logic's `evaluatePhoneNumberReport`: the
 * numbering plan always, the bound `phoneIntelligence` provider's line type, SIM swap and porting
 * when bound, and reachability from the inquiry's confirmed SMS code for a completion report only
 * (P05). Every number is in the NANP fictional range.
 */
import { NUMBERING_PLAN_TYPES, PHONE_LEVEL_REASONS, PHONE_LINE_TYPES } from '@openverify/checks';
import {
  PHONE_NUMBERING_PLAN_TYPES,
  PHONE_RISK_REASONS,
  PHONE_TYPES,
  phoneNumberReportResourceSchema,
} from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contactJobDatabase,
  submittedOtpVerification,
  type ContactJobDatabase,
} from '../../contact/job-testing.js';
import { ProviderError } from '../../providers/errors.js';
import { createPhoneIntelligenceProvider } from '../../providers/phone-intelligence/index.js';
import type { PhoneIntelligenceProvider } from '../../ports.js';
import { fixedClock } from '../../test-support/fakes.js';
import type { ReportRunResult, RunOutcome } from './job.js';
import { phoneNumberReportJob } from './phone-number.js';
import {
  REPORT_NOW,
  reportContext,
  servedReport,
  type ReportContextOptions,
} from './provider-testing.js';

function completed(outcome: RunOutcome): ReportRunResult {
  if (outcome.kind !== 'completed') {
    throw new Error('the run did not complete');
  }
  return outcome.result;
}

const attributesOf = (result: ReportRunResult) => result.result as Record<string, unknown>;
const reasonOf = (result: ReportRunResult, field: string) =>
  result.unavailableFields.find((entry) => entry.field === field)?.reason;

function context(phoneNumber: string, options: Omit<ReportContextOptions, 'type' | 'query'> = {}) {
  return reportContext({
    type: 'phone-number',
    query: { 'phone-number': phoneNumber },
    ...options,
  });
}

const sandboxProvider = () =>
  createPhoneIntelligenceProvider('sandbox', { clock: fixedClock(REPORT_NOW) });

function served(ctx: ReturnType<typeof context>, result: ReportRunResult) {
  expect(phoneNumberReportResourceSchema.safeParse(servedReport(ctx, result)).success).toBe(true);
}

describe('the phone-number report (C82.2)', () => {
  it('answers an ordinary US number from the plan alone: type undetermined, low at 0.3', async () => {
    const ctx = context('+12025550100');
    const result = completed(await phoneNumberReportJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(attributesOf(result)).toMatchObject({
      'phone-country-code': 'US',
      'phone-is-valid': true,
      'phone-type': null,
      'phone-type-numbering-plan': 'FIXED_LINE_OR_MOBILE',
      'phone-risk-level': 'low',
      'phone-risk-recommendation': 'allow',
      'phone-risk-confidence': 0.3,
      'phone-risk-score': null,
    });
    expect(reasonOf(result, 'phone-type')).toBe('line_type_undetermined');
    expect(reasonOf(result, 'phone-carrier')).toBe('provider_not_configured');
    expect(reasonOf(result, 'phone-reachable-at-otp')).toBe('not_linked');
    expect(result.provider).toBeNull();
    expect(result.thresholds).toMatchObject({ 'sim-swap-high-hours': 24 });
    served(ctx, result);
  });

  it('reads the sandbox provider: a SIM swap within 24 h is high, non-fixed VoIP blocks', async () => {
    const swapped = context('+12025550103', {
      providers: { phoneIntelligence: sandboxProvider() },
    });
    const swap = completed(await phoneNumberReportJob.run(swapped));
    expect(attributesOf(swap)).toMatchObject({
      'phone-type': 'MOBILE',
      'phone-carrier': 'Sandbox Carrier',
      'phone-risk-level': 'high',
      'phone-risk-sim-swap': 'high',
    });
    expect(attributesOf(swap)['phone-risk-reasons']).toContain('sim_swap_24h');
    expect(swap.provider).toEqual({ id: 'sandbox', sandbox: true });
    served(swapped, swap);

    const voip = completed(
      await phoneNumberReportJob.run(
        context('+12025550101', { providers: { phoneIntelligence: sandboxProvider() } }),
      ),
    );
    expect(attributesOf(voip)).toMatchObject({
      'phone-type': 'VOIP',
      'phone-risk-recommendation': 'block',
    });

    const ported = completed(
      await phoneNumberReportJob.run(
        context('+12025550104', { providers: { phoneIntelligence: sandboxProvider() } }),
      ),
    );
    expect(attributesOf(ported)).toMatchObject({
      'phone-ported-recently': true,
      'phone-risk-level': 'medium',
    });
  });

  it('reads a sandbox prepaid line as medium / flag with the reason prepaid (owner decision 14)', async () => {
    const prepaid = context('+12025550102', {
      providers: { phoneIntelligence: sandboxProvider() },
    });
    const result = completed(await phoneNumberReportJob.run(prepaid));
    expect(attributesOf(result)).toMatchObject({
      'phone-type': 'PREPAID',
      'phone-risk-level': 'medium',
      'phone-risk-recommendation': 'flag',
      'phone-risk-confidence': 0.4,
      'phone-risk-reasons': ['prepaid'],
    });
    expect(reasonOf(result, 'phone-risk-level')).toBeUndefined();
    served(prepaid, result);
  });

  it('retries a provider failure while attempts remain, then records it', async () => {
    const failing: PhoneIntelligenceProvider = {
      id: 'twilio-lookup',
      sandbox: false,
      lookup: () =>
        Promise.reject(new ProviderError('twilio-lookup: down', { retryable: true, code: 'x' })),
    };
    await expect(
      phoneNumberReportJob.run(
        context('+12025550100', { providers: { phoneIntelligence: failing } }),
      ),
    ).rejects.toThrow(ProviderError);

    const ctx = context('+12025550100', { providers: { phoneIntelligence: failing }, attempt: 5 });
    const result = completed(await phoneNumberReportJob.run(ctx));
    expect(reasonOf(result, 'phone-carrier')).toBe('execution_error');
    served(ctx, result);
  });

  it('throws a defect even on the last attempt: the framework ends it errored', async () => {
    const broken: PhoneIntelligenceProvider = {
      id: 'twilio-lookup',
      sandbox: false,
      lookup: () => Promise.reject(new TypeError('a defect, not a lookup failure')),
    };
    await expect(
      phoneNumberReportJob.run(
        context('+12025550100', { providers: { phoneIntelligence: broken }, attempt: 5 }),
      ),
    ).rejects.toThrow(TypeError);
  });

  it('errors a query that is not the type’s with insufficient_input', async () => {
    const ctx = reportContext({ type: 'phone-number', query: {} });
    const result = completed(await phoneNumberReportJob.run(ctx));
    expect(result.errors).toEqual([{ code: 'insufficient_input' }]);
    served(ctx, result);

    // Not E.164 (a completion report's typed field, say): errored, never read as a number.
    const local = reportContext({ type: 'phone-number', query: { 'phone-number': '2025550100' } });
    expect(completed(await phoneNumberReportJob.run(local)).errors).toEqual([
      { code: 'insufficient_input' },
    ]);
  });

  it('serves the contracts’ vocabularies', () => {
    expect([...PHONE_LINE_TYPES]).toEqual([...PHONE_TYPES]);
    expect([...NUMBERING_PLAN_TYPES]).toEqual([...PHONE_NUMBERING_PLAN_TYPES]);
    expect([...PHONE_LEVEL_REASONS]).toEqual([...PHONE_RISK_REASONS]);
  });
});

describe('the phone-number report’s reachability (C82.2, P05)', () => {
  let fixture: ContactJobDatabase;

  beforeAll(async () => {
    fixture = await contactJobDatabase();
  });

  afterAll(async () => {
    await fixture.database.close();
  });

  it('is true only for a completion report whose inquiry confirmed exactly this number', async () => {
    const { inquiryId } = await submittedOtpVerification(
      fixture,
      fixture.sandboxId,
      'phone_number',
      {
        destination: '+12025550100',
      },
    );
    const completion = (phoneNumber: string) =>
      context(phoneNumber, {
        db: fixture.db,
        environmentId: fixture.sandboxId,
        origin: 'inquiry_completion',
        inquiryId,
      });

    const confirmed = completed(await phoneNumberReportJob.run(completion('+12025550100')));
    expect(attributesOf(confirmed)['phone-reachable-at-otp']).toBe(true);

    const other = completed(await phoneNumberReportJob.run(completion('+12025550199')));
    expect(attributesOf(other)['phone-reachable-at-otp']).toBeNull();
    expect(reasonOf(other, 'phone-reachable-at-otp')).toBe('not_confirmed');
  });
});
