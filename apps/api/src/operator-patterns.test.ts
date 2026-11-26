/**
 * C252.3 (Workflow 11B, ingestion-11b; hardening H16, G-REGEX, BX-D1): the API's entry points of
 * operator patterns (inventory 2.8), each held to the known catastrophic pattern, `(a+)+$` over
 * 10,000 `a`s and a `!`, refused or matched within 50 ms of CPU time (never the wall clock):
 * - the server's screen submission (`flow-engine/screen-submission.ts`), which matches a published
 *   screen's `pattern` through C148.3's linear-time matcher and fails closed on a pattern it cannot
 *   compile (a stored one the publish rule would refuse today);
 * - a template whose flow-spec 1 form field carries a pattern: the write is refused (no v1 `form`
 *   step is a supported template step, `SUPPORTED_FLOW_STEP_TYPES`), and the schema it parses with
 *   no longer compiles the pattern natively (`packages/flow-spec/src/operator-patterns.test.ts`
 *   holds `v1FieldPatternProblems`);
 * - a transaction `json` field's schema: `pattern`, `patternProperties` and `format` are outside
 *   the publish-time allowlist, so no operator regex reaches ajv's code generation (K7C-R009 holds
 *   the compiler itself, `services/transactions/json-schemas.test.ts`).
 * Every value is synthetic.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { jsonSchemaKeywordProblems } from '@openverify/core';
import { screenStepSchema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateScreenSubmission } from './flow-engine/screen-submission.js';
import { createInquiryTestApi, type InquiryTestApi } from './services/inquiries.test-support.js';
import { bearer } from './test-support/harness.js';

const CATASTROPHIC = '(a+)+$';
const CATASTROPHIC_INPUT = `${'a'.repeat(10_000)}!`;
const CPU_BUDGET_MS = 50;

/**
 * The CPU time `run` takes, as `packages/checks/src/document/testing.ts`'s helper measures it.
 *
 * The least of three runs, as its `cpuRatio` takes the least of its rounds, so a garbage collection
 * another test's allocations started inside one run is not counted (rule 6: the budget held only
 * one test under the load of a whole shard).
 */
function cpuMilliseconds(run: () => void): number {
  let least = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 3; round += 1) {
    const before = process.cpuUsage();
    run();
    const used = process.cpuUsage(before);
    least = Math.min(least, (used.user + used.system) / 1000);
  }
  return least;
}

const screenWith = (pattern: string) =>
  screenStepSchema.parse({
    id: 'about',
    type: 'screen',
    components: [
      { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nick', pattern },
      { id: 'go', kind: 'button', labelKey: 'about.go', action: 'submit' },
    ],
  });

/** The refusal the submission throws, or `null` when it accepts the value. */
function refusalOf(pattern: string, value: string): unknown {
  try {
    validateScreenSubmission(screenWith(pattern), {}, { values: { nickname: value } });
    return null;
  } catch (error) {
    return error;
  }
}

describe('the server’s screen submission (C148.3, C252.3)', () => {
  // Warm the module's code paths once, so the measured call is the match alone.
  refusalOf('^[a-z]+$', 'warm');

  it('fails closed on the catastrophic pattern within 50 ms of CPU', () => {
    let refusal: unknown;
    const cpu = cpuMilliseconds(() => {
      refusal = refusalOf(CATASTROPHIC, CATASTROPHIC_INPUT);
    });
    expect(refusal).toMatchObject({
      errors: [
        expect.objectContaining({
          pointer: '/values/nickname',
          detail: 'The value does not have the expected form.',
        }),
      ],
    });
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });

  it.each(['^(a|aa)*$', '(a|a)*', '^a*a*a*a*$'])(
    'matches the catastrophic input against the ambiguous pattern %s within 50 ms of CPU',
    (pattern) => {
      let refusal: unknown;
      let accepted: unknown;
      const cpu = cpuMilliseconds(() => {
        refusal = refusalOf(pattern, `${'a'.repeat(9_999)}!`);
        accepted = refusalOf(pattern, 'a'.repeat(10_000));
      });
      expect(refusal).not.toBeNull();
      expect(accepted).toBeNull();
      expect(cpu).toBeLessThan(CPU_BUDGET_MS * 2);
    },
  );

  it('refuses a value past the matcher’s input cap without matching it', () => {
    let refusal: unknown;
    const cpu = cpuMilliseconds(() => {
      refusal = refusalOf('^(a|aa)*$', 'a'.repeat(10_001));
    });
    expect(refusal).not.toBeNull();
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });
});

describe('a transaction json field schema (C104.3, C252.1)', () => {
  it.each([
    { type: 'string', pattern: CATASTROPHIC },
    { type: 'object', patternProperties: { [CATASTROPHIC]: { type: 'string' } } },
    { type: 'string', format: 'regex' },
  ])('refuses %j at publish, before ajv sees it', (schema) => {
    let problems: ReturnType<typeof jsonSchemaKeywordProblems> = [];
    const cpu = cpuMilliseconds(() => {
      problems = jsonSchemaKeywordProblems(schema);
    });
    expect(problems).toContainEqual(expect.objectContaining({ code: 'field_schema_invalid' }));
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });
});

describe('a flow-spec 1 form field pattern at template creation (C252.1)', () => {
  let api: InquiryTestApi;

  beforeAll(async () => {
    api = await createInquiryTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('refuses the write; nothing compiles the pattern', async () => {
    const attributes = defaultInquiryTemplateAttributes();
    const flow = structuredClone(attributes.flow) as { steps: Record<string, unknown>[] };
    flow.steps.splice(1, 0, {
      id: 'details',
      type: 'form',
      fields: [
        {
          type: 'text',
          name: 'nickname',
          labelKey: 'form.nickname',
          required: false,
          validation: { pattern: CATASTROPHIC },
        },
      ],
    });
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
      payload: { data: { attributes: { ...attributes, flow } } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { pointer: string }[] }>().errors).toContainEqual(
      expect.objectContaining({ pointer: '/data/attributes/flow/steps/1/type' }),
    );
    expect(response.body).not.toContain(CATASTROPHIC);
  });
});
