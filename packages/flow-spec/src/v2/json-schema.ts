/**
 * C147.1 (owner `flow-spec-logic`): the v2 JSON Schema (draft 2020-12) `schema:export` writes to
 * `schema/flow.v2.schema.json`, beside the v1 document `schema/flow.schema.json`, so third-party
 * tools can validate either version. Generated from the zod schema; it describes the shapes, and
 * the rules that need the whole graph are `checkFlowGraph`'s.
 */
import { z } from 'zod';
import { flowV2Schema } from './schemas/flow.js';

export const FLOW_V2_SCHEMA_ID = 'urn:openverify:flow-spec:2';

export function flowV2JsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(flowV2Schema, { target: 'draft-2020-12', io: 'output' });
  return {
    $schema: generated.$schema,
    $id: FLOW_V2_SCHEMA_ID,
    title: 'OpenVerify verification flow, spec 2',
    description:
      'A graph of steps and port-labelled edges. The graph, component, field and publish rules are enforced by checkFlowGraph() in @openverify/flow-spec.',
    ...generated,
  };
}
