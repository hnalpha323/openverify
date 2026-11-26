/**
 * C147.1, C147.8: every flow-spec version, and one entry point that reads any of them. Stored
 * template versions are never rewritten: a v1 document stays v1 and is read with `flowV1Schema`
 * (today's `flowSchema`, unchanged); `migrateFlow` of `../migrate.ts` turns one into v2.
 */
import { FlowSpecError, flowSchema, toJsonPointer, type Flow, type FlowIssue } from '../../flow.js';
import { flowV2Schema, type FlowV2 } from './flow.js';

export const FLOW_SPEC_VERSIONS = Object.freeze([1, 2] as const);
export type FlowSpecVersion = (typeof FLOW_SPEC_VERSIONS)[number];

/** Version 1, exactly today's `flowSchema`. */
export const flowV1Schema = flowSchema;
export type FlowV1 = Flow;

export type AnyFlow = FlowV1 | FlowV2;

export type SafeParseAnyFlowResult =
  | { success: true; version: FlowSpecVersion; data: AnyFlow }
  | { success: false; issues: FlowIssue[] };

function versionOf(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return undefined;
  const metadata = (input as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  return (metadata as { specVersion?: unknown }).specVersion;
}

/**
 * Parses a flow of any version, dispatching on `metadata.specVersion`; every issue carries its
 * RFC 6901 `pointer` and the dotted `path` (kept for existing callers, C147.8).
 */
export function safeParseAnyFlow(input: unknown): SafeParseAnyFlowResult {
  const version = versionOf(input);
  const schema = version === 1 ? flowV1Schema : version === 2 ? flowV2Schema : null;
  if (schema === null) {
    return {
      success: false,
      issues: [
        {
          pointer: toJsonPointer(['metadata', 'specVersion']),
          path: 'metadata.specVersion',
          message: `specVersion must be one of ${FLOW_SPEC_VERSIONS.join(', ')}`,
        },
      ],
    };
  }
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { success: true, version: version as FlowSpecVersion, data: parsed.data };
  }
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      pointer: toJsonPointer(issue.path),
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}

/** @throws {FlowSpecError} listing every problem found. */
export function parseAnyFlow(input: unknown): AnyFlow {
  const result = safeParseAnyFlow(input);
  if (!result.success) {
    throw new FlowSpecError(result.issues);
  }
  return result.data;
}

/** Whether a parsed flow is version 2. */
export function isFlowV2(flow: AnyFlow): flow is FlowV2 {
  return flow.metadata.specVersion === 2;
}
