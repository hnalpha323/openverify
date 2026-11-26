/**
 * C147 (Workflow 9A Stage 1a): the building blocks every flow-spec v2 schema shares. Frozen
 * after Stage 1a; the rules that need the whole graph (C147.6) live in `../graph.ts`.
 */
import { z } from 'zod';

/** The format's version (C147.1). Version 1 is `flowSchema` of `../../flow.ts`, unchanged. */
export const FLOW_SPEC_V2 = 2;

/**
 * C147.5 (decision 23; ours, provisional; the public plan caps of 3 routes and 20 steps are not
 * ours). Basis: the largest public examples and the C3 session size, with room for growth. The
 * schemas bound the counts; the byte caps (a step's serialised config, the whole flow) and the
 * container depth are checked by `../graph.ts`.
 */
export const FLOW_V2_CAPS = Object.freeze({
  steps: 200,
  edges: 400,
  routesPerBranch: 20,
  componentsPerScreen: 40,
  containerDepth: 3,
  options: 1000,
  nameLength: 200,
  stepConfigBytes: 16 * 1024,
  flowBytes: 512 * 1024,
  patternLength: 500,
  valueLength: 10_000,
  waitFacts: 20,
  waitMaxSeconds: 30,
  stepperLabels: 20,
  tagsPerAction: 50,
  mappingEntries: 100,
});

/** A step id, as in v1 (C147.2): opaque and builder-generated, visible to the person. */
export const STEP_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/** An edge id: the step id pattern, unique among edges. */
export const edgeIdSchema = z
  .string()
  .regex(STEP_ID_PATTERN, 'must be lowercase letters, digits, _ or -, starting with a letter');

/** A route's or a submit button's key, which names its port (`route:<key>`, `button:<key>`). */
export const PORT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const portKeySchema = z.string().regex(PORT_KEY_PATTERN, 'must be a snake_case key');

/**
 * C147.4: the output ports. `next` (every non-terminal step but `branch`), `exhausted`
 * (verification steps), `button:<key>` (a screen's further submit buttons), `route:<key>` and
 * `else` (`branch`), `error` (`action`). Which port a step may use is a graph rule.
 */
export const PORT_PATTERN =
  /^(?:next|exhausted|error|else|button:[a-z][a-z0-9_]{0,39}|route:[a-z][a-z0-9_]{0,39})$/;
export const portSchema = z
  .string()
  .regex(PORT_PATTERN, 'must be next, exhausted, error, else, button:<key> or route:<key>');

/** A template field key (C149.2): `INQUIRY_FIELD_NAME_PATTERN` of the inquiry contract. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const fieldKeySchema = z.string().regex(FIELD_KEY_PATTERN, 'must be a snake_case field key');

/** A component id, unique within its screen; copy keys are `<step id>.<component id>.<attribute>`. */
export const componentIdSchema = z
  .string()
  .regex(STEP_ID_PATTERN, 'must be lowercase letters, digits, _ or -, starting with a letter');

/** A display name an operator gives a step (never sent to a client, C151.5). */
export const nameSchema = z.string().min(1).max(FLOW_V2_CAPS.nameLength);

/**
 * A path into the flow scope (C150.2), such as `verifications.id_card.age-years` or
 * `signals.inquiry/bot_score`. Typed against the scope at publish (C150.3), never here.
 */
export const scopePathSchema = z
  .string()
  .min(1)
  .max(300)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9_-]*(?:\.[A-Za-z0-9_/-]+)*$/, 'must be a dotted scope path');

/**
 * A condition in Phase 8's JSONLogic dialect (C114), kept opaque here: it is typed at publish by
 * `@openverify/workflow-engine` against the flow scope and evaluated on the server only (ADR 0008).
 */
export const conditionSchema = z.record(z.string(), z.unknown());

/**
 * A visibility or enablement rule (C148.4): the strict subset over `screen.<field>` of the same
 * screen, checked and evaluated by `../visibility.ts` alone.
 */
export const visibilityRuleSchema = z.record(z.string(), z.unknown());

/** A literal a mapping may carry instead of a scope path. */
export const literalSchema = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]);

/** A value read from the scope, or a literal (C152.2, C152.4). */
export const valueSourceSchema = z.union([
  z.strictObject({ path: scopePathSchema }),
  z.strictObject({ literal: literalSchema }),
]);

/** A public id `<prefix>_<ULID>` (C1), checked by shape only. */
export function publicIdSchema(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[0-7][0-9A-HJKMNP-TV-Z]{25}$`), `must be a ${prefix}_ id`);
}

/** Lists whose items must be distinct, as v1's `uniqueList`. */
export function distinctList<Item extends z.ZodType>(item: Item) {
  return z
    .array(item)
    .min(1)
    .refine((values) => new Set(values).size === values.length, 'must not contain duplicates')
    .meta({ uniqueItems: true });
}
