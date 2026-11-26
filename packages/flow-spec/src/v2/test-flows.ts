/**
 * Builders for the v2 flows the flow-spec-logic tests use (Workflow 9A Stage 2). Test support,
 * not product code: every flow it builds is parsed by `flowV2Schema`, so a test never feeds a
 * shape the schema refuses unless it says so with `rawFlow`.
 */
import { flowV2Schema, type FlowV2 } from './schemas/flow.js';

type Json = Record<string, unknown>;

/** `[from, port, to]`, given edge ids `e1`, `e2`, ... in order. */
export type EdgeSpec = readonly [from: string, port: string, to: string];

/** An unparsed v2 flow: for the tests that feed a shape on purpose. */
export function rawFlow(
  steps: readonly Json[],
  edges: readonly EdgeSpec[],
  entry?: string,
  id = 'test-flow',
): Json {
  return {
    metadata: { specVersion: 2, id, version: 1, name: 'Test flow' },
    entry: entry ?? steps[0]?.id ?? 'missing',
    steps: [...steps],
    edges: edges.map(([from, port, to], index) => ({
      id: `e${String(index + 1)}`,
      from,
      port,
      to,
    })),
  };
}

/** A parsed v2 flow; throws when the schema refuses it, so a test sees the reason. */
export function flowOf(steps: readonly Json[], edges: readonly EdgeSpec[], entry?: string): FlowV2 {
  return flowV2Schema.parse(rawFlow(steps, edges, entry));
}

// Steps ---------------------------------------------------------------------------------------

export const consent = (id = 'consent', extra: Json = {}): Json => ({
  id,
  type: 'consent',
  textKeys: ['consent.biometric'],
  required: true,
  ...extra,
});

export const governmentId = (id = 'id_card', extra: Json = {}): Json => ({
  id,
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
  ...extra,
});

export const selfie = (id = 'face', extra: Json = {}): Json => ({
  id,
  type: 'selfie',
  poses: ['center'],
  liveness: 'passive',
  maxAttempts: 2,
  ...extra,
});

export const document = (id = 'proof', extra: Json = {}): Json => ({
  id,
  type: 'document',
  documentTypes: ['utility_bill'],
  captureMethods: ['upload'],
  ...extra,
});

export const phone = (id = 'phone', extra: Json = {}): Json => ({
  id,
  type: 'phone_otp',
  allowedCountries: ['US'],
  ...extra,
});

export const email = (id = 'email', extra: Json = {}): Json => ({
  id,
  type: 'email_otp',
  ...extra,
});

export const nfc = (id = 'chip', extra: Json = {}): Json => ({
  id,
  type: 'nfc',
  androidOnly: true,
  ...extra,
});

export const aamva = (id = 'aamva', source: 'government_id' | 'form' = 'government_id'): Json => ({
  id,
  type: 'aamva',
  source,
});

export const database = (id = 'database', extra: Json = {}): Json => ({
  id,
  type: 'database',
  fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
  ...extra,
});

export const handoff = (id = 'handoff'): Json => ({ id, type: 'device_handoff' });

export const completion = (id = 'done', extra: Json = {}): Json => ({
  id,
  type: 'completion',
  ...extra,
});

export const failure = (id = 'rejected', extra: Json = {}): Json => ({
  id,
  type: 'failure',
  ...extra,
});

export const branch = (id: string, routes: readonly Json[], extra: Json = {}): Json => ({
  id,
  type: 'branch',
  routes: [...routes],
  ...extra,
});

export const route = (key: string, condition: Json, onNull?: string): Json => ({
  key,
  label: key,
  condition,
  ...(onNull === undefined ? {} : { onNull }),
});

export const action = (id: string, actionConfig: Json): Json => ({
  id,
  type: 'action',
  action: actionConfig,
});

export const screen = (id: string, components: readonly Json[], extra: Json = {}): Json => ({
  id,
  type: 'screen',
  components: [...components],
  ...extra,
});

// Components ----------------------------------------------------------------------------------

export const textInput = (id: string, field: string, extra: Json = {}): Json => ({
  id,
  kind: 'text_input',
  field,
  labelKey: `${id}.label`,
  ...extra,
});

export const submit = (id = 'continue', port?: string): Json => ({
  id,
  kind: 'button',
  labelKey: `${id}.button`,
  action: 'submit',
  ...(port === undefined ? {} : { port }),
});

export const text = (id: string, extra: Json = {}): Json => ({
  id,
  kind: 'text',
  variant: 'body',
  copyKey: `${id}.body`,
  ...extra,
});

/** `{"var": path}`. */
export const v = (path: string): Json => ({ var: path });
