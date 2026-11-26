/**
 * C154.7 (Workflow 9A): deployments (`dply_`), one per publish of a template version in its own
 * environment. Owner: `api-templates`; frozen by `foundation-9a` (Stage 1b (T)).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { deployments, type DeploymentRow } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

export type Deployment = DeploymentRow;

/** Who published: a user, or an API key for a version published through the API. */
export interface DeploymentCreator {
  type: 'user' | 'api-key';
  id: string;
}

/** A publish: the version deployed and the deployment it superseded on the template. */
export interface NewDeployment {
  id: string;
  templateId: string;
  versionId: string;
  sourceDeploymentId: string | null;
  creator: DeploymentCreator;
}

/** `GET /deployments`' filters (always the caller's environment). */
export interface ListDeploymentsOptions extends PageRequest {
  inquiryTemplateId?: readonly string[] | undefined;
}

const cursor = environmentCursor(deployments);

/** Writes the deployment of a publish, in the publish's transaction. */
export async function createDeploymentInTx(
  tx: Db,
  environmentId: string,
  input: NewDeployment,
): Promise<Deployment> {
  return inserted(
    await tx
      .insert(deployments)
      .values({
        id: input.id,
        environmentId,
        inquiryTemplateId: input.templateId,
        inquiryTemplateVersionId: input.versionId,
        sourceDeploymentId: input.sourceDeploymentId,
        creatorType: input.creator.type,
        creatorId: input.creator.id,
      })
      .returning(),
    'createDeploymentInTx',
  );
}

export async function getDeployment(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Deployment | null> {
  return firstOrNull(
    await db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, id), eq(deployments.environmentId, environmentId)))
      .limit(1),
  );
}

/** The template's newest deployment, which the next publish supersedes; `null` for none. */
export async function latestDeploymentOfTemplate(
  db: Db,
  environmentId: string,
  inquiryTemplateId: string,
): Promise<Deployment | null> {
  return firstOrNull(
    await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.environmentId, environmentId),
          eq(deployments.inquiryTemplateId, inquiryTemplateId),
        ),
      )
      .orderBy(desc(deployments.createdAt), desc(deployments.id))
      .limit(1),
  );
}

/** Newest first (C1's `created_at DESC, id DESC`). */
export async function listDeployments(
  db: Db,
  environmentId: string,
  options: ListDeploymentsOptions,
): Promise<Page<Deployment>> {
  const filters = allFilters([
    eq(deployments.environmentId, environmentId),
    equalsAny(deployments.inquiryTemplateId, options.inquiryTemplateId),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, cursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(deployments)
      .where(and(...filters, after))
      .orderBy(...newestFirst(cursor))
      .limit(limit),
  );
}
