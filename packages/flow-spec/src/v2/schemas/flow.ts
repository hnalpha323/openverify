/**
 * C147.1, C147.2 (decision 4): the v2 flow. A graph of steps and port-labelled edges, like Phase
 * 8's definitions: steps run only along edges, and list order is the outline's display order.
 * The schema checks shapes and the uniqueness of ids; every rule that needs the graph (entry and
 * endpoints exist, ports valid and wired, reachability, cycles, dominance, the publish rules) is
 * `checkFlowGraph` of `../graph.ts`, run after it.
 */
import { z } from 'zod';
import { metadataSchema, stepIdSchema } from '../../flow.js';
import { FLOW_SPEC_V2, FLOW_V2_CAPS, edgeIdSchema, portSchema } from './common.js';
import { stepV2Schema } from './steps.js';

export const metadataV2Schema = metadataSchema
  .extend({ specVersion: z.literal(FLOW_SPEC_V2) })
  .meta({ id: 'FlowMetadataV2' });

/** C147.4: one edge leaves one output port; any edge may target any step (a connector). */
export const edgeSchema = z
  .strictObject({ id: edgeIdSchema, from: stepIdSchema, port: portSchema, to: stepIdSchema })
  .meta({ id: 'Edge' });

/** The builder's node positions; never part of `flow-sha256` (C147.7). */
export const layoutSchema = z.record(
  stepIdSchema,
  z.strictObject({ x: z.number().min(-1e6).max(1e6), y: z.number().min(-1e6).max(1e6) }),
);

export const flowV2Schema = z
  .strictObject({
    metadata: metadataV2Schema,
    entry: stepIdSchema,
    steps: z.array(stepV2Schema).min(1, 'a flow needs at least one step').max(FLOW_V2_CAPS.steps),
    edges: z.array(edgeSchema).max(FLOW_V2_CAPS.edges),
    layout: layoutSchema.optional(),
  })
  .superRefine((flow, ctx) => {
    const steps = new Set<string>();
    flow.steps.forEach((step, index) => {
      if (steps.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate step id "${step.id}"`,
          path: ['steps', index, 'id'],
        });
      }
      steps.add(step.id);
    });
    const edges = new Set<string>();
    flow.edges.forEach((edge, index) => {
      if (edges.has(edge.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate edge id "${edge.id}"`,
          path: ['edges', index, 'id'],
        });
      }
      edges.add(edge.id);
    });
  })
  .meta({ id: 'FlowV2' });

export type FlowV2 = z.infer<typeof flowV2Schema>;
export type FlowV2Edge = z.infer<typeof edgeSchema>;
export type FlowV2Metadata = z.infer<typeof metadataV2Schema>;
