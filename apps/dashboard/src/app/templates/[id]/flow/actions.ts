'use server';

/**
 * The flow builder's server actions (C154.2, C154.3, C154.9, C155.6): the draft saved with
 * `If-Match` and `meta.allow-invalid` (a draft with problems is stored and says so), a 412 answered
 * with the latest draft to reload, the publish check (every rule the API runs, the async hooks
 * included, and the acknowledgements it needs) and publish with `If-Match`. Each input is parsed
 * with the contract's schemas before anything is sent.
 */
import { idSchema } from '@openverify/contracts';
import { flowV2Schema, migrateFlow } from '@openverify/flow-spec';
import { z } from 'zod';
import type { PublishCheck, SaveOutcome } from '../../../../components/flow-builder/flow-builder';
import type { ActionResult } from '../../../../lib/action-state';
import { parseInput, runAction } from '../../../../lib/api/action';
import {
  isPreconditionFailed,
  publishTemplateVersion,
  retrieveTemplateVersion,
  updateTemplateVersion,
  validateTemplateVersion,
} from '../../../../lib/api/inquiry-template-versions';

const etagSchema = z.string().min(1).max(200);

export async function saveFlowDraft(input: {
  readonly versionId: string;
  readonly flow: unknown;
  readonly etag: string;
  /** C160.7: the version's theme set; `null` clears it, absent leaves it. */
  readonly themeSetId?: string | null;
}): Promise<ActionResult<SaveOutcome>> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const versionId = parseInput(idSchema('itmplv'), input.versionId);
    const flow = parseInput(flowV2Schema, input.flow);
    const etag = parseInput(etagSchema, input.etag);
    const themeSetId =
      input.themeSetId === undefined
        ? undefined
        : parseInput(idSchema('theset').nullable(), input.themeSetId);
    try {
      const saved = await updateTemplateVersion(
        versionId,
        { flow, ...(themeSetId === undefined ? {} : { 'theme-set-id': themeSetId }) },
        etag,
      );
      return {
        kind: 'saved',
        etag: saved.etag,
        problems: saved.version.attributes.validation?.problems ?? [],
      };
    } catch (error) {
      if (!isPreconditionFailed(error)) {
        throw error;
      }
      const latest = await retrieveTemplateVersion(versionId);
      return {
        kind: 'conflict',
        latest: { flow: migrateFlow(latest.version.attributes.flow), etag: latest.etag },
      };
    }
  });
}

export async function checkFlowPublish(input: {
  readonly versionId: string;
}): Promise<ActionResult<PublishCheck>> {
  return runAction({ permissions: ['inquiry-templates:read'] }, async () => {
    const versionId = parseInput(idSchema('itmplv'), input.versionId);
    const answer = await validateTemplateVersion(versionId, { mode: 'publish' });
    return {
      problems: answer.validation.problems,
      acknowledgements: answer['acknowledgements-required'],
    };
  });
}

export async function publishFlowDraft(input: {
  readonly versionId: string;
  readonly etag: string;
  readonly acknowledgements: readonly string[];
  readonly note: string;
}): Promise<ActionResult<{ readonly etag: string }>> {
  return runAction({ permissions: ['inquiry-templates:publish'] }, async () => {
    const versionId = parseInput(idSchema('itmplv'), input.versionId);
    const etag = parseInput(etagSchema, input.etag);
    const acknowledgements = parseInput(z.array(z.string().max(240)).max(400), [
      ...input.acknowledgements,
    ]);
    const note = parseInput(z.string().max(255), input.note.trim());
    const published = await publishTemplateVersion(
      versionId,
      { acknowledgements, ...(note === '' ? {} : { publishNote: note }) },
      etag,
    );
    // No revalidation (Workflow 9C): it would send this route again with the answer, and a
    // template without a draft has no builder, so the Published status would be unmounted. Every
    // console page renders per request (C170.1), so the next navigation reads the new version.
    return { etag: published.etag };
  });
}
