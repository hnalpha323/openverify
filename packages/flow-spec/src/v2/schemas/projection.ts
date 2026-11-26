/**
 * C151.6 (decisions 2 and 73; V02, V03; the owner's decision after Workflow 9A's stop): the
 * `flow` member every client receives. Version 1 metadata; `steps` of v1 steps that have a v1 form
 * or `server-continuation` placeholders; no transition. A placeholder stands for every step with no
 * v1 form (a screen, a branch, an action, a wait, a consent with custom copy, and a verification
 * step with an `exhausted` edge); a spec-1 client decodes its unknown type as unsupported and stops
 * there. The golden projections are `contracts/fixtures/api/flow-projections/`, which the Android
 * host test `FlowCoordinatorProjectionTest` drives today's SDK over.
 */
import { z } from 'zod';
import {
  aamvaStepSchema,
  businessWebsiteStepSchema,
  completionStepSchema,
  consentStepSchema,
  cryptoWalletStepSchema,
  databaseBusinessStepSchema,
  databaseStepSchema,
  deviceHandoffStepSchema,
  documentStepSchema,
  emailOtpStepSchema,
  failureStepSchema,
  governmentIdStepSchema,
  metadataSchema,
  nfcStepSchema,
  phoneOtpStepSchema,
  selfieStepSchema,
  transitionSchema,
} from '../../flow.js';

export const SERVER_CONTINUATION_STEP_TYPE = 'server-continuation';

/** `continue-<n>`, numbered from 1 in list order. */
export const serverContinuationStepSchema = z
  .strictObject({
    id: z.string().regex(/^continue-[1-9][0-9]{0,3}$/, 'must be continue-<n>'),
    type: z.literal(SERVER_CONTINUATION_STEP_TYPE),
  })
  .meta({ id: 'ServerContinuationStep' });

/** The v1 steps a projection may list: every v1 type but `form`, which is not a v2 type. */
export const projectedStepSchema = z.discriminatedUnion('type', [
  consentStepSchema,
  governmentIdStepSchema,
  selfieStepSchema,
  documentStepSchema,
  phoneOtpStepSchema,
  emailOtpStepSchema,
  databaseStepSchema,
  aamvaStepSchema,
  nfcStepSchema,
  cryptoWalletStepSchema,
  databaseBusinessStepSchema,
  businessWebsiteStepSchema,
  deviceHandoffStepSchema,
  completionStepSchema,
  failureStepSchema,
  serverContinuationStepSchema,
]);

const TERMINAL: ReadonlySet<string> = new Set(['completion', 'failure']);

export const flowProjectionSchema = z
  .strictObject({
    metadata: metadataSchema,
    steps: z.array(projectedStepSchema).min(1),
    /** Always empty: no condition is ever sent (C151.6). */
    transitions: z.array(transitionSchema).max(0, 'a projection carries no transition'),
  })
  .superRefine((projection, ctx) => {
    const ids = new Set<string>();
    let placeholders = 0;
    let ended = false;
    for (const [index, step] of projection.steps.entries()) {
      if (ids.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate step id "${step.id}"`,
          path: ['steps', index, 'id'],
        });
      }
      ids.add(step.id);
      if (ended) {
        ctx.addIssue({
          code: 'custom',
          message: 'nothing follows a terminal step or a placeholder',
          path: ['steps', index],
        });
      }
      if (step.type === SERVER_CONTINUATION_STEP_TYPE) {
        placeholders += 1;
        if (step.id !== `continue-${String(placeholders)}`) {
          ctx.addIssue({
            code: 'custom',
            message: `the placeholder is continue-${String(placeholders)}`,
            path: ['steps', index, 'id'],
          });
        }
      }
      ended = ended || TERMINAL.has(step.type) || step.type === SERVER_CONTINUATION_STEP_TYPE;
    }
    if (!ended) {
      ctx.addIssue({
        code: 'custom',
        message: 'a projection ends at a terminal step or a placeholder',
        path: ['steps'],
      });
    }
  })
  .meta({ id: 'FlowProjection' });

export type FlowProjection = z.infer<typeof flowProjectionSchema>;
export type ProjectedStep = z.infer<typeof projectedStepSchema>;
