/**
 * The v1 flows C147.10's migration is golden-tested on (test support): every v1 flow stored in
 * `contracts/fixtures/` (found by a scan, the projections left out since they are not stored
 * flows), the flow-spec test fixture `validFlow`, and the synthetic branching flows below, which
 * cover each rule of the migration and the equivalence test of C151.3 (review F07). Synthetic data
 * only.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { flowSchema, type Flow } from '../../flow.js';
import { validFlow } from '../../test-fixtures.js';

export interface V1Source {
  /** The golden file's name. */
  readonly name: string;
  /** Where the flow comes from: a fixture file and pointer, or this module. */
  readonly source: string;
  readonly flow: Flow;
}

const FIXTURES = path.resolve(import.meta.dirname, '../../../../../contracts/fixtures');

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function* v1FlowsIn(value: unknown, pointer: string): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      yield* v1FlowsIn(item, `${pointer}/${String(index)}`);
    return;
  }
  if (!isRecord(value)) return;
  const metadata = value.metadata;
  if (isRecord(metadata) && metadata.specVersion === 1 && 'transitions' in value) {
    yield [pointer, value];
    return;
  }
  for (const [key, member] of Object.entries(value)) yield* v1FlowsIn(member, `${pointer}/${key}`);
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'flow-projections' ? [] : filesUnder(full);
    return entry.name.endsWith('.json') ? [full] : [];
  });
}

/** Every stored v1 flow in `contracts/fixtures/`, in path order. */
export function fixtureV1Sources(): V1Source[] {
  const sources: V1Source[] = [];
  for (const file of filesUnder(FIXTURES).sort()) {
    const relative = path.relative(FIXTURES, file);
    for (const [pointer, value] of v1FlowsIn(JSON.parse(readFileSync(file, 'utf8')), '')) {
      const parsed = flowSchema.safeParse(value);
      if (!parsed.success) continue;
      const name = `fixture-${relative.replace(/\.json$/, '').replaceAll(/[^a-z0-9]+/gi, '-')}`;
      sources.push({
        name: name.toLowerCase(),
        source: `contracts/fixtures/${relative}#${pointer}`,
        flow: parsed.data,
      });
    }
  }
  return sources;
}

const v1 = (id: string, steps: readonly Json[], transitions: readonly Json[] = []): Flow =>
  flowSchema.parse({
    metadata: { specVersion: 1, id, version: 1, name: `Synthetic ${id}` },
    steps,
    transitions,
  });

const consent = { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true };
const idCard = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
};
const face = { id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 2 };
const proof = {
  id: 'proof',
  type: 'document',
  documentTypes: ['utility_bill'],
  captureMethods: ['upload'],
};
const done = { id: 'done', type: 'completion', messageKey: 'flow.completion' };
const rejected = { id: 'rejected', type: 'failure', messageKey: 'flow.failure' };
const status = { var: 'inquiry.status' };

/** Synthetic v1 flows, one per migration rule. */
export const SYNTHETIC_V1_SOURCES: readonly V1Source[] = [
  {
    name: 'synthetic-linear-no-terminal',
    source: 'synthetic: list order only, the last step not terminal (a synthetic completion)',
    flow: v1('linear-open', [consent, idCard, face]),
  },
  {
    name: 'synthetic-routes-then-unconditional',
    source: 'synthetic: two conditional transitions before an unconditional one, one after it',
    flow: v1(
      'routes',
      [consent, idCard, proof, face, done, rejected],
      [
        { from: 'id_card', to: 'rejected', condition: { '==': [status, 'failed'] } },
        { from: 'id_card', to: 'proof', condition: { '!=': [status, 'pending'] } },
        { from: 'id_card', to: 'face' },
        { from: 'id_card', to: 'done' },
      ],
    ),
  },
  {
    name: 'synthetic-conditional-only',
    source: 'synthetic: conditional transitions only, else the next step in list order',
    flow: v1(
      'conditional-only',
      [consent, idCard, face, done],
      [
        {
          from: 'consent',
          to: 'face',
          condition: { and: [{ '===': [status, 'completed'] }, { '!!': [status] }] },
        },
      ],
    ),
  },
  {
    name: 'synthetic-outside-context',
    source:
      'synthetic: conditions on paths outside v1’s context, a var default, loose equality and a null operand',
    flow: v1(
      'outside',
      [consent, idCard, face, proof, done],
      [
        { from: 'consent', to: 'proof', condition: { '==': [{ var: 'platform' }, 'android'] } },
        { from: 'consent', to: 'face', condition: { '!': [{ var: 'verifications.id.status' }] } },
        {
          from: 'id_card',
          to: 'done',
          condition: { '==': [{ var: ['inquiry.status', 'x'] }, 'completed'] },
        },
        {
          from: 'id_card',
          to: 'proof',
          condition: { '==': [{ var: ['device.kind', 'web'] }, 'web'] },
        },
        { from: 'id_card', to: 'face', condition: { '==': [status, 1] } },
        {
          from: 'id_card',
          to: 'face',
          condition: { and: [{ '==': [status, 'pending'] }, { var: 'x' }] },
        },
        { from: 'face', to: 'done', condition: { '!=': [{ var: 'attempts' }, 1] } },
      ],
    ),
  },
  {
    name: 'synthetic-form-and-ids',
    source:
      'synthetic: a form step, a branch id that is taken, and a step after a verification before consent',
    flow: v1(
      'form-ids',
      [
        {
          id: 'details',
          type: 'form',
          fields: [
            {
              type: 'text',
              name: 'continue',
              labelKey: 'form.nickname',
              required: true,
              validation: { minLength: 2, maxLength: 20, pattern: '^(a+)+$' },
            },
            {
              type: 'date',
              name: 'birthdate',
              labelKey: 'form.birthdate',
              required: false,
              validation: { max: '2010-01-01' },
            },
            { type: 'email', name: 'email', labelKey: 'form.email', required: false },
            {
              type: 'phone',
              name: 'phone',
              labelKey: 'form.phone',
              required: false,
              validation: { allowedCountries: ['US'] },
            },
            {
              type: 'select',
              name: 'occupation',
              labelKey: 'form.occupation',
              required: false,
              options: [
                { value: 'employed', labelKey: 'form.occupation.employed' },
                { value: 'other', labelKey: 'form.occupation.other' },
              ],
            },
            { type: 'country', name: 'residence', labelKey: 'form.residence', required: true },
          ],
        },
        { ...idCard, id: 'details-routes' },
        consent,
        done,
      ],
      [{ from: 'details', to: 'done', condition: { '===': [status, 'expired'] } }],
    ),
  },
  {
    name: 'synthetic-long-id',
    source: 'synthetic: a step id so long that its branch id needs the hash suffix',
    flow: v1(
      'long-id',
      [consent, { ...idCard, id: `id_${'x'.repeat(61)}` }, done],
      [{ from: `id_${'x'.repeat(61)}`, to: 'done', condition: { '==': [status, 'pending'] } }],
    ),
  },
];

/** The flow-spec test fixture (`src/test-fixtures.ts`). */
export const TEST_FIXTURE_V1_SOURCE: V1Source = {
  name: 'flow-spec-valid-flow',
  source: 'packages/flow-spec/src/test-fixtures.ts validFlow()',
  flow: flowSchema.parse(validFlow()),
};

/** Every v1 source, each name once. */
export function allV1Sources(): V1Source[] {
  return [...fixtureV1Sources(), TEST_FIXTURE_V1_SOURCE, ...SYNTHETIC_V1_SOURCES];
}
