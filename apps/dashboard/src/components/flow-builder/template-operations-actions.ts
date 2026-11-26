'use server';

/**
 * C154.4, C154.5, C155.7 (Workflow 9D, fix-builder): copy a template and promote one of its
 * versions into another environment, through the console's tested clients (`apiRequest`; the node
 * client is not widened, S9C-11). Each input is parsed before anything is sent; the API checks
 * every right itself, the promote's in both environments.
 */
import { idSchema } from '@openverify/contracts';
import { z } from 'zod';
import type { ActionResult } from '../../lib/action-state';
import { parseInput, runAction } from '../../lib/api/action';
import { copyTemplate, promoteTemplate } from '../../lib/api/inquiry-templates';

export interface CopiedTemplate {
  readonly id: string;
  readonly name: string;
}

export interface PromotedVersion {
  readonly versionId: string;
  readonly versionNumber: number;
  /** How many theme sets the promote copied into the target (C160.8). */
  readonly copiedThemeSets: number;
}

const nameSchema = z.string().trim().min(1).max(100);

const versionIdOf = (versionId: string | undefined): { versionId?: string } =>
  versionId === undefined ? {} : { versionId: parseInput(idSchema('itmplv'), versionId) };

/** `POST /inquiry-templates/:id/copy`: a new template whose draft copies the version. */
export async function copyTemplateAction(input: {
  readonly templateId: string;
  readonly name: string;
  readonly versionId?: string;
}): Promise<ActionResult<CopiedTemplate>> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const templateId = parseInput(idSchema('itmpl'), input.templateId);
    const name = parseInput(nameSchema, input.name);
    const copied = await copyTemplate(templateId, { name, ...versionIdOf(input.versionId) });
    return { id: copied.id, name: copied.attributes.name };
  });
}

/** `POST /inquiry-templates/:id/promote`: a draft in `environmentId` (people only). */
export async function promoteTemplateAction(input: {
  readonly templateId: string;
  readonly environmentId: string;
  readonly versionId?: string;
}): Promise<ActionResult<PromotedVersion>> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const templateId = parseInput(idSchema('itmpl'), input.templateId);
    const environmentId = parseInput(idSchema('env'), input.environmentId);
    const promoted = await promoteTemplate(templateId, {
      environmentId,
      ...versionIdOf(input.versionId),
    });
    return {
      versionId: promoted.version.id,
      versionNumber: promoted.version.attributes['version-number'],
      copiedThemeSets: promoted.copied.length,
    };
  });
}
