/**
 * C238.2 (verification V06; Workflow 11A): the one publish-check hook of Connect, called once from
 * Phase 9's `flowPublishReport` (`services/publish/flow-v2.ts`). It runs every Connect publish check of
 * the phase over the version (`connect-logic`'s pure `connectPublishRules`): a source-side step's
 * connection (`share_consent_connection_invalid`, the warning `share_consent_connection_not_active`),
 * `share_consent_after_completion`, `share_consent_after_cloned_step`,
 * `share_consent_connect_disabled` (C231.10), `cloned_results_without_binding` (C235.8),
 * `share_consent_withdrawal_contact_missing` (C237.4), `share_consent_retention_missing` (C238.9),
 * and records the acknowledgements `cloned-results`, `cloned-results-unbound` and
 * `share-consent-default-text` through the existing publish-acknowledgement path (the report's
 * acknowledgements, which `publishRulesInTx` requires and stores with the publishing user).
 *
 * What it reads beyond the version: the template organisation's outbound connections each step names
 * (an organisation-scoped read, never another environment's rows), the environment's retention, and
 * flow-spec's counsel review status. A share into a template is taken to be able to carry
 * `biometric` (fail closed, C238.9: an inbound connection's policy may allow it at any time).
 *
 * `foundation-11a` placed the call (Stage 1b (K)); `api-consent` builds it (its file).
 */
import {
  acceptClonedResultsSchema,
  fromApiVerificationType,
  API_VERIFICATION_TYPES,
  verificationConfigSchema,
} from '@openverify/contracts';
import { connectPublishRules, type ConnectPublishChecks } from '@openverify/core';
import {
  getConsentConnection,
  getEnvironment,
  type Db,
  type InquiryTemplateVersion,
} from '@openverify/db';
import {
  COUNSEL_REVIEW_STATUS,
  isFlowV2,
  safeParseAnyFlow,
  type FlowV2,
} from '@openverify/flow-spec';
import type { PublishAcknowledgement } from '../publish/flow-v2.js';
import { storedCopy } from '../templates/versions.js';
import type { TemplateRuleProblem } from '../templates/versions.js';

/** What the checks read beyond the version. */
export interface ConnectPublishInput {
  environment: { id: string; kind: 'sandbox' | 'production' };
  templateId: string;
  version: InquiryTemplateVersion;
  /** C231.10: whether the install allows Connect (`config.connect.enabled`). */
  connectEnabled: boolean;
  /** C235.8: the publish's `meta.acknowledgements`; left out by a draft's validation. */
  givenAcknowledgements?: readonly string[] | undefined;
}

export interface ConnectPublishReport {
  problems: TemplateRuleProblem[];
  acknowledgements: PublishAcknowledgement[];
}

/** The checks of `verification-config` by core verification type, as `flowPublishReport` reads them. */
function checksOf(config: unknown): ConnectPublishChecks {
  const parsed = verificationConfigSchema.safeParse(config);
  const checks: Record<string, Record<string, { enabled: boolean; required: boolean }>> = {};
  if (!parsed.success) return checks;
  for (const apiType of API_VERIFICATION_TYPES) {
    const typeConfig = parsed.data[apiType];
    if (typeConfig !== undefined) {
      checks[fromApiVerificationType(apiType)] = typeConfig.checks;
    }
  }
  return checks;
}

const COUNSEL_UNREVIEWED_KEYS: readonly string[] = Object.freeze(
  Object.entries(COUNSEL_REVIEW_STATUS)
    .filter(([, status]) => status === 'counsel-unreviewed')
    .map(([key]) => key),
);

const settingOf = (version: InquiryTemplateVersion, key: string): unknown =>
  (version.settings as Record<string, unknown> | null | undefined)?.[key];

/** C238.2: every Connect problem and acknowledgement of a publish of `version`. */
export async function connectPublishChecks(
  db: Db,
  input: ConnectPublishInput,
): Promise<ConnectPublishReport> {
  const { version } = input;
  const parsed = safeParseAnyFlow(version.flow);
  const flow: FlowV2 | null = parsed.success && isFlowV2(parsed.data) ? parsed.data : null;
  const accepted = acceptClonedResultsSchema.safeParse(settingOf(version, 'accept-cloned-results'));
  const acceptClonedResults = accepted.success ? accepted.data : null;
  const shareSteps =
    flow?.steps.filter((step) => step.type === 'share_consent') ?? ([] as FlowV2['steps']);
  if (shareSteps.length === 0 && acceptClonedResults === null) {
    return { problems: [], acknowledgements: [] };
  }

  const environment = await getEnvironment(db, input.environment.id);
  const outboundConnections: Record<string, string> = {};
  for (const step of shareSteps) {
    const connectionId = (step as { connectionId?: string }).connectionId;
    if (environment === null || connectionId === undefined) continue;
    const connection = await getConsentConnection(db, environment.organizationId, connectionId);
    if (connection?.sourceOrganizationId === environment.organizationId) {
      outboundConnections[connection.id] = connection.status;
    }
  }
  const templateRetention = settingOf(version, 'retention-days');
  const environmentRetention = environment?.settings['inquiry-retention-days'];
  const retentionDays =
    typeof templateRetention === 'number'
      ? templateRetention
      : typeof environmentRetention === 'number'
        ? environmentRetention
        : null;

  const report = connectPublishRules({
    flow,
    acceptClonedResults,
    checks: checksOf(version.verificationConfig),
    connectEnabled: input.connectEnabled,
    outboundConnections,
    retentionDays,
    destinationBiometricPossible: true,
    copy: storedCopy(version).messages,
    enabledLocales: [...version.enabledLocales],
    counselUnreviewedKeys: COUNSEL_UNREVIEWED_KEYS,
    ...(input.givenAcknowledgements === undefined
      ? {}
      : { givenAcknowledgements: input.givenAcknowledgements }),
  });
  return {
    problems: report.problems.map((problem) => ({ ...problem })),
    acknowledgements: report.acknowledgements.map((acknowledgement) => ({ ...acknowledgement })),
  };
}
