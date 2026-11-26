/**
 * C116.4: what the publish rules read from the environment, inside the publish transaction. Nothing
 * here decides: `rules.ts` does. What cannot be read fails closed: a secret table that is not there
 * yet holds no key, and a template with no published version is unknown, which reads as biometric.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import {
  WORKFLOW_REFERENCE_KINDS,
  getEnvironment,
  getLists,
  listWorkflowSecretFacts,
  readInquiryTemplateFlows,
  readWorkflowReferences,
  readWorkflowTypeFacts,
  resolveSignalSettings,
  resolveWorkflowSettings,
  type Db,
} from '@openverify/db';
import type { ApiDependencies } from '../../services/context.js';
import type { WorkflowActing } from '../acting.js';
import { boundAdaptersOf } from '../adapters.js';
import { referencesIn } from './references.js';
import type { PublishFacts } from './rules.js';

export interface LoadedPublishFacts {
  facts: PublishFacts;
  /** C128.4: `undefined` for a template nothing is known of, which fails closed. */
  templateIsBiometric: (templateId: string) => boolean | undefined;
}

const holdsSelfie = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(holdsSelfie);
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type } = value as { type?: unknown };
  return type === 'selfie' || Object.values(value).some(holdsSelfie);
};

export async function biometricTemplates(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, boolean>> {
  const flows = await readInquiryTemplateFlows(db, environmentId, ids);
  const { faceLists } = await readWorkflowTypeFacts(db, environmentId);
  return new Map(
    flows.map(({ inquiryTemplateId, flow, listConfig }) => {
      const screen = (listConfig as { screen?: unknown }).screen;
      const screensEveryList = screen === undefined || screen === 'all';
      return [inquiryTemplateId, holdsSelfie(flow) || (screensEveryList && faceLists > 0)];
    }),
  );
}

export async function loadPublishFacts(
  deps: ApiDependencies,
  db: Db,
  acting: WorkflowActing,
  definition: WorkflowDefinition,
): Promise<LoadedPublishFacts> {
  const { environmentId } = acting.ctx;
  const environment = await getEnvironment(db, environmentId);
  const settings = environment?.settings ?? {};
  const workflowSettings = resolveWorkflowSettings(settings);
  const references = referencesIn(definition);
  const known = await Promise.all(
    WORKFLOW_REFERENCE_KINDS.map((kind) =>
      readWorkflowReferences(
        db,
        environmentId,
        kind,
        references.filter((reference) => reference.kind === kind).map(({ id }) => id),
      ),
    ),
  );
  const listIds = references.filter(({ kind }) => kind === 'list').map(({ id }) => id);
  const lists = await getLists(db, environmentId, [...new Set(listIds)]);
  const types = await readWorkflowTypeFacts(db, environmentId);
  const biometric = await biometricTemplates(
    db,
    environmentId,
    references.filter(({ kind }) => kind === 'inquiry-template').map(({ id }) => id),
  );
  return {
    facts: {
      environmentKind: acting.environmentKind,
      flowHost: new URL(deps.flowPublicUrl).hostname,
      linkHosts: workflowSettings['workflow-link-hosts'],
      emailRecipients: workflowSettings['workflow-email-recipients'],
      smsRecipients: workflowSettings['workflow-sms-recipients'],
      boundAdapters: boundAdaptersOf(deps, acting.environmentKind),
      listPurposes: new Map(lists.map((list) => [list.id, list.purpose])),
      transactionAdverseStatuses: new Set(types.transactionAdverseStatuses),
      transactionTypesContest: types.transactionTypesContest,
      accountTypesContest: types.accountTypesContest,
      secrets: await listWorkflowSecretFacts(db, acting.ctx.organizationId, environmentId),
      knownReferences: new Set(known.flat().map(({ id }) => id)),
      exposeSignals: resolveSignalSettings(settings)['expose-signals'],
    },
    templateIsBiometric: (templateId) => biometric.get(templateId),
  };
}
