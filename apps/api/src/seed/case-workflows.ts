/**
 * C140.5, C146.3 (Workflow 8B): the dev seed's case side. The case recipes reach the seed through
 * `WORKFLOW_RECIPE_ROWS` (`seedWorkflowRecipes`); what they need of cases to run end to end is a
 * template to open their cases on, so this seeds one: "Review" (`REVIEW-1`, `REVIEW-2`, ...),
 * published with C130.2's defaults (Open, Pending, Approved, Declined; the resolutions Approved and
 * Declined; every held kind), visible to every role that reads cases. A contest route (C128.7) and
 * "Review on report match" can name it. Run again, it adds nothing. Owner `api-case-workflows`;
 * `foundation-8b` froze the signature and its call in `seed/dev-seed.ts`.
 */
import { newId } from '@openverify/contracts';
import {
  CASE_HELD_OBJECT_TYPES,
  DEFAULT_CASE_RESOLUTIONS,
  DEFAULT_CASE_STATUSES,
} from '@openverify/core';
import {
  caseTemplates,
  createCaseTemplateRow,
  createCaseTemplateVersionRow,
  publishCaseTemplateVersionRow,
  type Db,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';

/** C130.1: the key of the review template the seed makes, the prefix of its cases' names. */
export const REVIEW_TEMPLATE_KEY = 'REVIEW';

/** The seed's case side. `seededBy` is the seeded operator; a template records no author. */
export const seedCaseWorkflows: (
  db: Db,
  environmentId: string,
  seededBy: string,
) => Promise<void> = (db, environmentId) =>
  db.transaction(async (tx) => {
    const [held] = await tx
      .select({ id: caseTemplates.id })
      .from(caseTemplates)
      .where(
        and(
          eq(caseTemplates.environmentId, environmentId),
          eq(caseTemplates.key, REVIEW_TEMPLATE_KEY),
        ),
      )
      .limit(1);
    if (held !== undefined) {
      return;
    }
    const template = await createCaseTemplateRow(tx, environmentId, {
      id: newId('ctmpl'),
      name: 'Review',
      key: REVIEW_TEMPLATE_KEY,
      visibleToRoles: [],
    });
    const version = await createCaseTemplateVersionRow(tx, environmentId, {
      id: newId('ctmplv'),
      caseTemplateId: template.id,
      content: {
        fieldSchemas: [],
        statuses: DEFAULT_CASE_STATUSES,
        resolutions: DEFAULT_CASE_RESOLUTIONS,
        transitions: null,
        defaultQueueId: null,
        assignmentPolicyId: null,
        slaPolicyId: null,
        slaStartsOn: 'created',
        heldObjectTypes: CASE_HELD_OBJECT_TYPES,
        attachmentPolicy: null,
        notifyOnCreate: [],
        layoutModules: null,
      },
    });
    await publishCaseTemplateVersionRow(tx, environmentId, version.id, new Date());
  });
