/**
 * C82.2: the `phone-number` report job (Workflow 6A Stage 3, owner `api-providers`), behind the
 * frozen `ReportTypeJob` of `jobs/report-types/index.ts`, over risk-logic's
 * `evaluatePhoneNumberReport`: the numbering plan (libphonenumber-js `/max`) always; the bound
 * `phoneIntelligence` provider's line type, carrier, SIM swap and porting when bound
 * (`twilio-lookup` or `sandbox`), read through `phoneIntelligenceLookupOf` so "not checked" is
 * never read as "no swap"; reachability from the inquiry's confirmed SMS code, for a completion
 * report only (P05). The answer is `ready` with every field it could compute; a provider that
 * failed for good leaves its fields `null` with `execution_error`. No score is synthesised
 * (decision 20).
 */
import { evaluatePhoneNumberReport, riskConstant } from '@openverify/checks';
import { phoneNumberQuerySchema } from '@openverify/contracts';
import { phoneIntelligenceLookupOf } from '../../providers/phone-intelligence/answer.js';
import type { ReportRunContext, ReportTypeJob, RunOutcome } from './job.js';
import {
  answeringProvider,
  contactConfirmationOf,
  erroredResult,
  providerOutcome,
} from './provider-reports.js';

/** ADR 0002 §3f: the windows the risk rule applied (provisional, risk-logic's constants). */
function phoneThresholds(): Record<string, number> {
  return {
    'sim-swap-high-hours': riskConstant('phone-sim-swap-high-hours'),
    'sim-swap-medium-hours': riskConstant('phone-sim-swap-medium-hours'),
    'sim-swap-low-hours': riskConstant('phone-sim-swap-low-hours'),
    'ported-recent-days': riskConstant('phone-ported-recent-days'),
  };
}

async function run(ctx: ReportRunContext): Promise<RunOutcome> {
  const query = phoneNumberQuerySchema.safeParse(ctx.report.query);
  if (!query.success) {
    return { kind: 'completed', result: erroredResult('insufficient_input') };
  }
  const phoneNumber = query.data['phone-number'];
  const provider = await providerOutcome(ctx, ctx.providers.phoneIntelligence, async (bound) =>
    phoneIntelligenceLookupOf(await bound.lookup({ phoneNumber })),
  );
  // C55.8 stores a confirmed destination in E.164, as the query is.
  const confirmation = await contactConfirmationOf(
    ctx,
    'phone_number',
    (destination) => destination.trim() === phoneNumber,
  );
  const evaluation = evaluatePhoneNumberReport({
    phoneNumber,
    now: ctx.deps.clock.now(),
    provider,
    confirmation,
  });
  return {
    kind: 'completed',
    result: {
      errors: [],
      sources: [],
      coverage: null,
      result: { ...evaluation.fields, details: evaluation.details },
      unavailableFields: evaluation.unavailableFields,
      provider: answeringProvider(provider),
      thresholds: phoneThresholds(),
      notices: [],
      matcherVersion: null,
      matches: [],
    },
  };
}

export const phoneNumberReportJob: ReportTypeJob = { type: 'phone-number', run };
