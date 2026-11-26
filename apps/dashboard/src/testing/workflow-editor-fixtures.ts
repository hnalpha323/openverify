/**
 * `console-editor`'s fixtures (C141; Workflow 8D): catalogue rows for the palette. Every value is
 * synthetic.
 */
import type { WorkflowActionResource } from '@openverify/contracts';

/** A catalogue row (C122.4) for `key`, available unless the overrides say otherwise. */
export function workflowAction(
  key: string,
  attributes: Partial<WorkflowActionResource['attributes']> = {},
): WorkflowActionResource {
  const version = attributes.version ?? 1;
  return {
    type: 'workflow-action',
    id: `${key}@${String(version)}`,
    attributes: {
      key,
      version,
      kind: 'internal',
      stage: 'ga',
      delivery: 'exactly-once',
      adverse: 'never',
      'config-schema': { type: 'object' },
      'output-schema': { type: 'object' },
      grant: { scopes: [], pii: false },
      'grant-depends-on-config': false,
      emits: [],
      triggers: null,
      available: true,
      reason: null,
      ...attributes,
    },
  };
}
