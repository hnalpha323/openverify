/**
 * C82.3: the `address-lookup` report job (Workflow 6A Stage 3, owner `api-providers`), behind the
 * frozen `ReportTypeJob` of `jobs/report-types/index.ts`. The R and H fields come from
 * risk-logic's `evaluateAddressLookupReport` (the normalised components, postcode validity, the
 * US ZIP-to-state check, the designators and the CMRA hint); the A fields (DPV, RDI, CMRA,
 * vacancy, LACSLink, SuiteLink, carrier route, county, precision) from the bound
 * `addressVerification` provider (`smarty`, `sandbox`). The provider receives what
 * `addressVerificationRequestOf` allows (P16): the normalised components of a US address, and the
 * addressee only with `send-addressee`; for any other country nothing is sent and the A fields are
 * `null` with `unsupported_country`. Every A field left `null` says why.
 */
import {
  ADDRESS_VERIFICATION_FIELDS,
  addressVerificationRequestOf,
  evaluateAddressLookupReport,
  type RiskUnavailableReason,
} from '@openverify/checks';
import { addressLookupQuerySchema } from '@openverify/contracts';
import type { ReportRunContext, ReportTypeJob, RunOutcome } from './job.js';
import { answeringProvider, erroredResult, providerOutcome } from './provider-reports.js';

interface VerifiedFields {
  fields: Record<string, string | number | boolean | null>;
  unavailable: { field: string; reason: RiskUnavailableReason }[];
}

/** Every A field `null`, for `reason`. */
function unanswered(reason: RiskUnavailableReason): VerifiedFields {
  return {
    fields: Object.fromEntries(ADDRESS_VERIFICATION_FIELDS.map((field) => [field, null])),
    unavailable: ADDRESS_VERIFICATION_FIELDS.map((field) => ({ field, reason })),
  };
}

async function run(ctx: ReportRunContext): Promise<RunOutcome> {
  const query = addressLookupQuerySchema.safeParse(ctx.report.query);
  if (!query.success) {
    return { kind: 'completed', result: erroredResult('insufficient_input') };
  }
  const evaluation = evaluateAddressLookupReport(query.data);
  const eligible = addressVerificationRequestOf(query.data, {
    sendAddressee: ctx.report.config['send-addressee'] === true,
  });
  let provider: { id: string; sandbox: boolean } | null = null;
  let verified: VerifiedFields;
  if (!eligible.eligible) {
    verified = unanswered(eligible.reason);
  } else {
    const { request } = eligible;
    const outcome = await providerOutcome(ctx, ctx.providers.addressVerification, (bound) =>
      bound.verify({ ...request }),
    );
    provider = answeringProvider(outcome);
    if (outcome.kind === 'not_configured') {
      verified = unanswered('provider_not_configured');
    } else if (outcome.kind === 'error') {
      verified = unanswered('execution_error');
    } else {
      const answer = outcome.result.fields;
      const fields = Object.fromEntries(
        ADDRESS_VERIFICATION_FIELDS.map((field) => [field, answer[field] ?? null]),
      );
      verified = {
        fields,
        unavailable: ADDRESS_VERIFICATION_FIELDS.filter((field) => fields[field] === null).map(
          (field) => ({ field, reason: 'undetermined' as const }),
        ),
      };
    }
  }
  return {
    kind: 'completed',
    result: {
      errors: [],
      sources: [],
      coverage: null,
      result: { ...evaluation.fields, ...verified.fields, details: evaluation.details },
      unavailableFields: [...evaluation.unavailableFields, ...verified.unavailable],
      provider,
      thresholds: null,
      notices: [],
      matcherVersion: null,
      matches: [],
    },
  };
}

export const addressLookupReportJob: ReportTypeJob = { type: 'address-lookup', run };
