import { z } from 'zod';
import { flowSchema } from './flow.js';

export const FLOW_SCHEMA_ID = 'urn:openverify:flow-spec:1';

/**
 * JSON Schema (draft 2020-12) for flow definitions, generated with zod's
 * native converter. It describes the parsed output (what clients receive).
 * Cross-reference rules (unique step ids, transitions to existing steps, no
 * transitions out of terminal steps, active liveness poses, form field and
 * select option uniqueness, min/max ordering) are enforced only by `parseFlow`.
 */
export function flowJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(flowSchema, { target: 'draft-2020-12', io: 'output' });
  return {
    $schema: generated.$schema,
    $id: FLOW_SCHEMA_ID,
    title: 'OpenVerify verification flow',
    description:
      'Server-driven verification flow. Cross-reference rules are enforced by parseFlow() in @openverify/flow-spec.',
    ...generated,
  };
}
