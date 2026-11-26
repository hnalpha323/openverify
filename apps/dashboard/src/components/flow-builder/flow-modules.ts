/**
 * C155.4 (Workflow 9D, fix-builder): the builder's modules, editor macros and never a runtime type.
 * Each inserts plain flow-spec 2 steps and edges at a place (a step's port) through the same model
 * functions as the palette, and says what it inserts before it is inserted (C155.11). A module the
 * format's own rules would refuse at that place is offered with the reason, never silently left
 * out: the refusal is the rule `checkFlowGraph` (the code the API runs) reports for the inserted
 * steps, so the builder keeps no second copy of a placement rule.
 */
import {
  checkFlowGraph,
  stepV2Schema,
  type FlowV2,
  type FlowV2Edge,
  type FlowV2Step,
  type FlowV2StepType,
} from '@openverify/flow-spec';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { edgeOnPort, idsOf, stepOf, stepPorts, stepTemplate, type Place } from './flow-model';
import { flowStepLabel } from './flow-outline-model';

export const FLOW_MODULE_KEYS = [
  'government_id',
  'selfie',
  'document',
  'database',
  'phone',
  'email',
  'success',
  'failed',
  'country_select',
] as const;
export type FlowModuleKey = (typeof FLOW_MODULE_KEYS)[number];

export interface ModuleOptions {
  /** A verification module also inserts an explanation screen before its step. */
  readonly explanation: boolean;
}

export interface ModuleOffer {
  readonly key: FlowModuleKey;
  readonly label: string;
  /** What the module inserts, in words, read before it is inserted (C155.11). */
  readonly inserts: string;
  /** Whether the explanation-screen option applies to it. */
  readonly explains: boolean;
  /** Why it cannot be inserted at this place, else `null`. */
  readonly refusal: string | null;
}

/** A new opaque id for a step (`s`) or an edge (`e`), never one the flow holds. */
export type IdSource = (prefix: 's' | 'e') => string;

export interface ModuleContext {
  readonly fieldSchemas?: readonly {
    readonly key: string;
    readonly type: string;
    readonly pii: boolean;
  }[];
}

const copy = FLOW_BUILDER_COPY;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** The verification step type each verification module inserts. */
const VERIFICATION_MODULES: Readonly<Partial<Record<FlowModuleKey, FlowV2StepType>>> = {
  government_id: 'government_id',
  selfie: 'selfie',
  document: 'document',
  database: 'database',
  phone: 'phone_otp',
  email: 'email_otp',
};

/** The modules that end the flow at their place. */
const TERMINAL_MODULES: Readonly<Partial<Record<FlowModuleKey, 'completion' | 'failure'>>> = {
  success: 'completion',
  failed: 'failure',
};

/** The graph rules that depend on where a step stands (C147.6), read from `checkFlowGraph`. */
const PLACEMENT_CODES: ReadonlySet<string> = new Set([
  'consent_not_dominating',
  'step_order_invalid',
  'verification_type_repeated',
]);

/** The country select's field (C149's default field set) and its one example route. */
const COUNTRY_FIELD = 'address_country_code';

function screen(id: string, name: string, components: readonly unknown[]): FlowV2Step {
  return stepV2Schema.parse({ id, type: 'screen', name, components });
}

const continueButton = {
  id: 'continue',
  kind: 'button',
  labelKey: 'screen.continue',
  action: 'submit',
} as const;

interface Built {
  readonly steps: readonly FlowV2Step[];
  /** The edges inside the module and from it onward; the place's own edge is added on insert. */
  readonly edges: readonly Omit<FlowV2Edge, 'id'>[];
  readonly head: string;
  readonly select: string;
}

function build(
  flow: FlowV2,
  place: Place,
  key: FlowModuleKey,
  options: ModuleOptions,
  nextId: IdSource,
): Built {
  const onward = edgeOnPort(flow, place.from, place.port)?.to;
  const toOnward = (from: string, port: string) =>
    onward === undefined ? [] : [{ from, port, to: onward }];
  const verification = VERIFICATION_MODULES[key];
  if (verification !== undefined) {
    const type = copy.stepTypes[verification];
    const explainId = options.explanation ? nextId('s') : null;
    const stepId = nextId('s');
    const fallbackId = nextId('s');
    const steps = [
      ...(explainId === null
        ? []
        : [
            screen(explainId, copy.modules.explanationTitle(type), [
              { id: 'title', kind: 'text', variant: 'title', copyKey: `${explainId}.title.title` },
              { id: 'body', kind: 'text', variant: 'body', copyKey: `${explainId}.body.body` },
              continueButton,
            ]),
          ]),
      stepTemplate(verification, stepId),
      screen(fallbackId, copy.modules.fallbackTitle(type), [
        { id: 'title', kind: 'text', variant: 'title', copyKey: `${fallbackId}.title.title` },
        continueButton,
      ]),
    ];
    return {
      steps,
      edges: [
        ...(explainId === null ? [] : [{ from: explainId, port: 'next', to: stepId }]),
        { from: stepId, port: 'exhausted', to: fallbackId },
        ...toOnward(stepId, 'next'),
        ...toOnward(fallbackId, 'next'),
      ],
      head: explainId ?? stepId,
      select: stepId,
    };
  }
  const terminal = TERMINAL_MODULES[key];
  if (terminal !== undefined) {
    const id = nextId('s');
    return { steps: [stepTemplate(terminal, id)], edges: [], head: id, select: id };
  }
  const screenId = nextId('s');
  const branchId = nextId('s');
  return {
    steps: [
      screen(screenId, copy.modules.countryTitle, [
        {
          id: 'country',
          kind: 'country_select',
          field: COUNTRY_FIELD,
          labelKey: `${screenId}.country.label`,
          required: true,
        },
        continueButton,
      ]),
      stepV2Schema.parse({
        id: branchId,
        type: 'branch',
        name: copy.modules.countryTitle,
        routes: [
          {
            key: 'us',
            label: copy.modules.countryRoute,
            condition: { '===': [{ var: `inquiry.fields.${COUNTRY_FIELD}` }, 'US'] },
            onNull: 'else',
          },
        ],
      }),
    ],
    edges: [
      { from: screenId, port: 'next', to: branchId },
      ...toOnward(branchId, 'route:us'),
      ...toOnward(branchId, 'else'),
    ],
    head: screenId,
    select: screenId,
  };
}

function assemble(flow: FlowV2, place: Place, built: Built, nextId: IdSource): FlowV2 {
  const before = edgeOnPort(flow, place.from, place.port);
  return {
    ...flow,
    steps: [...flow.steps, ...built.steps],
    edges: [
      ...flow.edges.filter((edge) => edge !== before),
      { id: nextId('e'), from: place.from, port: place.port, to: built.head },
      ...built.edges.map((edge) => ({ id: nextId('e'), ...edge })),
    ],
  };
}

/** Ids for a trial insertion: `<prefix>_` and 8 base32 characters the flow does not hold. */
function trialIds(flow: FlowV2): IdSource {
  const taken = idsOf(flow);
  let count = 0;
  return (prefix) => {
    for (;;) {
      count += 1;
      let digits = '';
      for (let rest = count, index = 0; index < 8; index += 1, rest = Math.floor(rest / 32)) {
        digits = (BASE32[rest % 32] ?? 'a') + digits;
      }
      const id = `${prefix}_${digits}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };
}

function inserts(key: FlowModuleKey, options: ModuleOptions): string {
  const verification = VERIFICATION_MODULES[key];
  if (verification !== undefined) {
    return copy.modules.verification(copy.stepTypes[verification], options.explanation);
  }
  if (key === 'success') return copy.modules.success;
  if (key === 'failed') return copy.modules.failed;
  return copy.modules.countrySelect;
}

function refusalOf(
  flow: FlowV2,
  place: Place,
  key: FlowModuleKey,
  options: ModuleOptions,
  context: ModuleContext,
): string | null {
  const source = stepOf(flow, place.from);
  if (source === undefined || !stepPorts(source).includes(place.port)) {
    return copy.modules.noPort;
  }
  const verification = VERIFICATION_MODULES[key];
  if (verification !== undefined && flow.steps.some((step) => step.type === verification)) {
    return copy.palette.oneOfEachVerification(copy.stepTypes[verification]);
  }
  const onward = edgeOnPort(flow, place.from, place.port)?.to;
  const onwardStep = onward === undefined ? undefined : stepOf(flow, onward);
  if (TERMINAL_MODULES[key] !== undefined && onwardStep !== undefined) {
    return copy.modules.leadsTo(flowStepLabel(flow, onwardStep));
  }
  // The format's own placement rules, run over the flow with the module in place.
  const ids = trialIds(flow);
  const built = build(flow, place, key, options, ids);
  const trial = assemble(flow, place, built, ids);
  const inserted = new Set(built.steps.map((step) => step.id));
  const refused = checkFlowGraph(trial, {
    mode: 'save',
    ...(context.fieldSchemas === undefined ? {} : { fieldSchemas: context.fieldSchemas }),
  }).find((problem) => {
    const match = /^\/steps\/(\d+)/.exec(problem.pointer);
    const step = match === null ? undefined : trial.steps[Number(match[1])];
    return (
      problem.severity === 'error' &&
      PLACEMENT_CODES.has(problem.code) &&
      step !== undefined &&
      inserted.has(step.id)
    );
  });
  return refused === undefined ? null : copy.modules.refused(refused.detail);
}

/** Every module, offered or refused at `place` with its reason. */
export function moduleOffers(
  flow: FlowV2,
  place: Place,
  options: ModuleOptions,
  context: ModuleContext = {},
): readonly ModuleOffer[] {
  return FLOW_MODULE_KEYS.map((key) => ({
    key,
    label: copy.modules.labels[key],
    inserts: inserts(key, options),
    explains: VERIFICATION_MODULES[key] !== undefined,
    refusal: refusalOf(flow, place, key, options, context),
  }));
}

/** `flow` with module `key` inserted at `place`, or `null` when it is refused there. */
export function insertModule(
  flow: FlowV2,
  place: Place,
  key: FlowModuleKey,
  options: ModuleOptions,
  nextId: IdSource,
  context: ModuleContext = {},
): { readonly flow: FlowV2; readonly select: string; readonly inserted: readonly string[] } | null {
  if (refusalOf(flow, place, key, options, context) !== null) {
    return null;
  }
  const built = build(flow, place, key, options, nextId);
  return {
    flow: assemble(flow, place, built, nextId),
    select: built.select,
    inserted: built.steps.map((step) => step.id),
  };
}
