/**
 * `POST /inquiry-template-versions/:id/simulate` (C156.4; Workflow 9B, `api-templates-carry`): the
 * stored version's flow (a flow-spec 1 flow through `migrateFlow`, as the engine walks it) simulated
 * over the body's scope or a preset (`simulate.ts`). Any version of the caller's environment, a draft
 * included. Nothing is stored, audited or sent: the answer is computed and returned.
 */
import type {
  SimulateInquiryTemplateVersionBody,
  SimulatedScope,
  templateSimulationDocumentSchema,
} from '@openverify/contracts';
import { isFlowV2, migrateFlow, safeParseAnyFlow, type FlowV2 } from '@openverify/flow-spec';
import type { z } from 'zod';
import { UnprocessableContentError } from '../../errors.js';
import type { Principal } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { findVersion } from '../inquiry-templates.js';
import { simulateFlow, SimulationScopeError } from './simulate.js';
import { presetScopeFor } from './simulation-presets.js';
import { storedFieldSchemas } from './versions.js';

export type TemplateSimulationDocument = z.infer<typeof templateSimulationDocumentSchema>;

/** The flow the engine would walk: as stored, or migrated from flow-spec 1. */
function walkedFlow(stored: unknown): FlowV2 {
  const parsed = safeParseAnyFlow(stored);
  if (!parsed.success) {
    throw new UnprocessableContentError('The version holds no flow that can be walked.', [
      {
        location: 'body',
        pointer: '/meta',
        detail: 'Fix the version’s flow before simulating it.',
      },
    ]);
  }
  return isFlowV2(parsed.data) ? parsed.data : migrateFlow(parsed.data);
}

/**
 * Simulates the version `id` of the principal's environment.
 * @throws {NotFoundError} for a version or a preset the principal cannot read.
 * @throws {UnprocessableContentError} for a scope the version does not hold, at its pointer.
 */
export async function simulateTemplateVersion(
  deps: ApiDependencies,
  principal: Principal,
  id: string,
  meta: SimulateInquiryTemplateVersionBody['meta'],
): Promise<TemplateSimulationDocument> {
  const { environmentId } = principal;
  const version = await findVersion(deps.db, environmentId, id);
  const flow = walkedFlow(version.flow);
  const now = deps.clock.now();
  const scope: SimulatedScope =
    meta.scope ??
    (await presetScopeFor(
      deps.db,
      {
        environmentId,
        userId: principal.kind === 'user' ? principal.userId : null,
        piiVisible: false,
      },
      meta['preset-id'] ?? '',
      flow,
      now,
    ));
  try {
    const attributes = simulateFlow(flow, scope, {
      verificationConfig: version.verificationConfig,
      fieldSchemas: storedFieldSchemas(version).map(({ key, type, pii }) => ({ key, type, pii })),
      now,
    });
    return { data: { type: 'inquiry-template-simulation', id, attributes } };
  } catch (error) {
    if (!(error instanceof SimulationScopeError)) throw error;
    // A body's scope is named at its own pointer; a preset's, at the preset, with the member's path.
    throw new UnprocessableContentError(
      'The simulated scope does not fit this template version.',
      error.problems.map(({ pointer, detail }) =>
        meta.scope === undefined
          ? { location: 'body', pointer: '/meta/preset-id', detail: `${pointer}: ${detail}` }
          : { location: 'body', pointer: `/meta/scope${pointer}`, detail },
      ),
    );
  }
}
