/**
 * Workflow 9A Stage 1a (C147-C152, C151.5, C151.6): the frozen v2 schemas. The golden flows are
 * shared with the other suites in `contracts/fixtures/flows/v2/`, and the golden projections with
 * the Android host test in `contracts/fixtures/api/flow-projections/`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flowSchema, safeParseFlow, toJsonPointer } from '../../flow.js';
import {
  COMPONENT_KINDS,
  FLOW_ACTION_KINDS,
  FLOW_SCOPE_EXTRACTIONS,
  FLOW_SCOPE_PATHS,
  FLOW_SPEC_VERSIONS,
  FLOW_V2_CAPS,
  FLOW_V2_STEP_TYPES,
  SCOPE_ROOTS,
  SCOPE_SOURCES,
  SERVER_CONTINUATION_STEP_TYPE,
  V2_ONLY_STEP_TYPES,
  VERIFICATION_STEP_TYPES,
  clientStepViewSchema,
  flowProjectionSchema,
  flowV1Schema,
  flowV2Schema,
  isFlowV2,
  parseAnyFlow,
  safeParseAnyFlow,
  stepV2Schema,
  type FlowScopeExtraction,
  type FlowV2Step,
  type ScopePathDescription,
} from './index.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../../contracts/fixtures');
const read = (relative: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, relative), 'utf8')) as unknown;
const clone = <T>(value: T): T => structuredClone(value);
const at = <T>(list: readonly T[], index: number): T => {
  const item = list[index];
  if (item === undefined) throw new Error(`no item ${String(index)}`);
  return item;
};

type Json = Record<string, unknown>;
const everyStep = () =>
  clone(read('flows/v2/every-step.json')) as Json & { steps: Json[]; edges: Json[] };
const stepOf = (flow: { steps: Json[] }, id: string): Json => {
  const step = flow.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return step;
};
const refused = (input: unknown) => flowV2Schema.safeParse(input).success;

describe('the v2 step types (C147.3)', () => {
  it('are the fourteen supported v1 types, device_handoff, screen, branch, action and (Workflow 11A) share_consent, and never form', () => {
    expect([...FLOW_V2_STEP_TYPES].sort()).toEqual(
      [
        'consent',
        'government_id',
        'selfie',
        'document',
        'phone_otp',
        'email_otp',
        'database',
        'aamva',
        'nfc',
        'crypto_wallet',
        'database_business',
        'business_website',
        'device_handoff',
        'completion',
        'failure',
        'screen',
        'branch',
        'action',
        'share_consent',
      ].sort(),
    );
    expect(stepV2Schema.safeParse({ id: 'about', type: 'form', fields: [] }).success).toBe(false);
    expect(V2_ONLY_STEP_TYPES).toEqual(['screen', 'branch', 'action', 'share_consent']);
    expect(VERIFICATION_STEP_TYPES).toHaveLength(11);
  });

  it('cover the golden flow, one of every step type, component kind and action kind', () => {
    const golden = everyStep();
    const parsed = flowV2Schema.parse(golden);
    expect(parsed).toEqual(golden);
    expect(new Set(parsed.steps.map((step: FlowV2Step) => step.type))).toEqual(
      new Set(FLOW_V2_STEP_TYPES),
    );
    const kinds = new Set<string>();
    const walk = (components: readonly Json[]) => {
      for (const component of components) {
        kinds.add(String(component.kind));
        if (Array.isArray(component.children)) walk(component.children as Json[]);
      }
    };
    walk(stepOf(golden, 'about_you').components as Json[]);
    expect(kinds).toEqual(new Set(COMPONENT_KINDS));
    const actions = golden.steps
      .filter((step) => step.type === 'action')
      .map((step) => (step.action as Json).kind);
    expect(new Set(actions)).toEqual(new Set(FLOW_ACTION_KINDS));
  });

  it('refuse a member no step type declares, as v1 does (strict objects)', () => {
    const flow = everyStep();
    stepOf(flow, 'id_card').flavour = 'mint';
    expect(refused(flow)).toBe(false);
  });
});

describe('the v2 flow (C147.2, C147.4, C147.5)', () => {
  it('needs version 2 metadata, an entry, steps and edges', () => {
    const flow = everyStep();
    (flow.metadata as Json).specVersion = 1;
    expect(refused(flow)).toBe(false);
    const noEntry = everyStep();
    delete noEntry.entry;
    expect(refused(noEntry)).toBe(false);
  });

  it('refuses a repeated step id and a repeated edge id', () => {
    const steps = everyStep();
    stepOf(steps, 'face').id = 'id_card';
    expect(
      flowV2Schema
        .safeParse(steps)
        .error?.issues.map((issue: { message: string }) => issue.message),
    ).toContain('duplicate step id "id_card"');
    const edges = everyStep();
    at(edges.edges, 1).id = 'e1';
    expect(
      flowV2Schema
        .safeParse(edges)
        .error?.issues.map((issue: { message: string }) => issue.message),
    ).toContain('duplicate edge id "e1"');
  });

  it('accepts the C147.4 ports only', () => {
    for (const port of ['next', 'exhausted', 'error', 'else', 'button:later', 'route:minor']) {
      const flow = everyStep();
      at(flow.edges, 0).port = port;
      expect(flowV2Schema.safeParse(flow).success, port).toBe(true);
    }
    for (const port of ['route:', 'button:Later', 'fallback', 'route:minor:2', 'Next']) {
      const flow = everyStep();
      at(flow.edges, 0).port = port;
      expect(refused(flow), port).toBe(false);
    }
  });

  it('bounds the counts of C147.5', () => {
    expect(FLOW_V2_CAPS).toMatchObject({
      steps: 200,
      edges: 400,
      routesPerBranch: 20,
      componentsPerScreen: 40,
      containerDepth: 3,
      options: 1000,
      nameLength: 200,
      stepConfigBytes: 16 * 1024,
      flowBytes: 512 * 1024,
    });
    const many = everyStep();
    many.steps = Array.from({ length: 201 }, (_, index) => ({
      id: `s${String(index)}`,
      type: 'completion',
    }));
    many.edges = [];
    expect(refused(many)).toBe(false);
    const routes = everyStep();
    const branch = stepOf(routes, 'age_route');
    branch.routes = Array.from({ length: 21 }, (_, index) => ({
      key: `r${String(index)}`,
      label: 'Route',
      condition: { '==': [1, 1] },
    }));
    expect(refused(routes)).toBe(false);
    const components = everyStep();
    stepOf(components, 'about_you').components = Array.from({ length: 41 }, (_, index) => ({
      id: `c${String(index)}`,
      kind: 'spacer',
      size: 's',
    }));
    expect(refused(components)).toBe(false);
  });
});

describe('screens and components (C148)', () => {
  const screenWith = (component: Json) => {
    const flow = everyStep();
    stepOf(flow, 'about_you').components = [component];
    return flow;
  };

  it('refuse a repeated component id, nested ones included', () => {
    const flow = everyStep();
    const components = stepOf(flow, 'about_you').components as Json[];
    components.push({ id: 'first_name', kind: 'spacer', size: 's' });
    expect(refused(flow)).toBe(false);
  });

  it('give a submit button alone a port, and a link button alone its link', () => {
    expect(
      refused(
        screenWith({ id: 'b', kind: 'button', labelKey: 'a.b', action: 'cancel', port: 'later' }),
      ),
    ).toBe(false);
    expect(refused(screenWith({ id: 'b', kind: 'button', labelKey: 'a.b', action: 'link' }))).toBe(
      false,
    );
    expect(
      refused(
        screenWith({
          id: 'b',
          kind: 'button',
          labelKey: 'a.b',
          action: 'submit',
          link: 'help-url',
        }),
      ),
    ).toBe(false);
    expect(
      refused(
        screenWith({ id: 'b', kind: 'button', labelKey: 'a.b', action: 'submit', port: 'later' }),
      ),
    ).toBe(true);
  });

  it('need an alt key for an image that is not decorative', () => {
    const image = {
      id: 'logo',
      kind: 'image',
      assetId: 'tsa_01M5CN00000000000000009A10',
      decorative: false,
    };
    expect(refused(screenWith(image))).toBe(false);
    expect(refused(screenWith({ ...image, altKey: 'about_you.logo.alt' }))).toBe(true);
  });

  it('key options by a generated key, unique, never by value alone', () => {
    const select = (options: Json[]) =>
      screenWith({ id: 's', kind: 'select', field: 'purpose', labelKey: 'a.s', options });
    expect(
      refused(
        select([
          { key: 'o1', value: 'a', labelKey: 'a.s.o1' },
          { key: 'o1', value: 'b', labelKey: 'a.s.o2' },
        ]),
      ),
    ).toBe(false);
    expect(
      refused(
        select([
          { key: 'o1', value: 'a', labelKey: 'a.s.o1' },
          { key: 'o2', value: 'a', labelKey: 'a.s.o2' },
        ]),
      ),
    ).toBe(false);
    expect(refused(select([{ key: 'O1', value: 'a', labelKey: 'a.s.o1' }]))).toBe(false);
  });

  it('take a pattern as text of at most 500 characters and never compile it here (C148.3)', () => {
    const input = (pattern: string) =>
      screenWith({ id: 'i', kind: 'text_input', field: 'nickname', labelKey: 'a.i', pattern });
    // `(` is not a valid ECMAScript pattern: the grammar check at publish refuses it, not the schema.
    expect(refused(input('('))).toBe(true);
    expect(refused(input('a'.repeat(501)))).toBe(false);
  });

  it('keep lengths, numbers and dates in order', () => {
    expect(
      refused(
        screenWith({
          id: 'i',
          kind: 'text_input',
          field: 'a',
          labelKey: 'a.i',
          minLength: 5,
          maxLength: 2,
        }),
      ),
    ).toBe(false);
    expect(
      refused(screenWith({ id: 'n', kind: 'number', field: 'a', labelKey: 'a.n', min: 5, max: 2 })),
    ).toBe(false);
    expect(
      refused(
        screenWith({
          id: 'd',
          kind: 'date',
          field: 'a',
          labelKey: 'a.d',
          min: '2026-02-01',
          max: '2026-01-01',
        }),
      ),
    ).toBe(false);
    expect(refused(screenWith({ id: 'p', kind: 'stepper', labelKeys: ['a.p'], current: 1 }))).toBe(
      false,
    );
  });
});

describe('branches (C150.1, C150.3, C150.5)', () => {
  it('take onNull as route:<key>, skip-route, else or review, never error, and no default', () => {
    for (const onNull of ['else', 'skip-route', 'review', 'route:risky']) {
      const flow = everyStep();
      at(stepOf(flow, 'age_route').routes as Json[], 0).onNull = onNull;
      expect(flowV2Schema.safeParse(flow).success, onNull).toBe(true);
    }
    for (const onNull of ['error', 'route:', 'fail']) {
      const flow = everyStep();
      at(stepOf(flow, 'age_route').routes as Json[], 0).onNull = onNull;
      expect(refused(flow), onNull).toBe(false);
    }
    const absent = everyStep();
    delete at(stepOf(absent, 'age_route').routes as Json[], 0).onNull;
    expect(refused(absent)).toBe(true);
  });

  it('refuse a repeated route key and a wait past 30 seconds', () => {
    const keys = everyStep();
    at(stepOf(keys, 'age_route').routes as Json[], 1).key = 'minor';
    expect(refused(keys)).toBe(false);
    const wait = everyStep();
    (stepOf(wait, 'age_route').waitFor as Json).maxSeconds = 31;
    expect(refused(wait)).toBe(false);
  });
});

describe('actions (C152)', () => {
  const withAction = (id: string, change: (action: Json) => void) => {
    const flow = everyStep();
    change(stepOf(flow, id).action as Json);
    return flow;
  };

  it('bound run_workflow at 300 seconds and take latest-published or a version id', () => {
    expect(refused(withAction('screening', (action) => (action.timeoutSeconds = 301)))).toBe(false);
    expect(
      refused(
        withAction('screening', (action) => (action.version = 'wfv_01M5CN00000000000000009A12')),
      ),
    ).toBe(true);
    expect(refused(withAction('screening', (action) => (action.version = 'latest')))).toBe(false);
  });

  it('take literal tags in their normal form only, and a snake_case review reason', () => {
    expect(refused(withAction('tagging', (action) => (action.add = [' padded '])))).toBe(false);
    expect(
      refused(withAction('tagging', (action) => ((action.add = []), (action.remove = [])))),
    ).toBe(false);
    expect(
      refused(withAction('review_flag', (action) => (action.reasonCode = 'Minor Applicant'))),
    ).toBe(false);
  });

  it('refuse a kind outside the closed list: no code and no HTTPS in a flow', () => {
    expect(refused(withAction('review_flag', (action) => (action.kind = 'evaluate_code')))).toBe(
      false,
    );
    expect(refused(withAction('review_flag', (action) => (action.kind = 'https_request')))).toBe(
      false,
    );
  });
});

describe('the additive v1 members (C147.3)', () => {
  it('take prefillFrom on an AAMVA step only when it collects a form', () => {
    const flow = everyStep();
    stepOf(flow, 'licence').source = 'government_id';
    expect(refused(flow)).toBe(false);
  });

  it('need a non-empty captureMethodsByDevice when present', () => {
    const flow = everyStep();
    stepOf(flow, 'id_card').captureMethodsByDevice = {};
    expect(refused(flow)).toBe(false);
  });

  it('give a failure step a contest route that reaches the person', () => {
    const flow = everyStep();
    stepOf(flow, 'failed_minor').contestRoute = {
      caseTemplateId: 'ctmpl_01M5CN00000000000000009A13',
    };
    expect(refused(flow)).toBe(false);
  });
});

describe('the v1 projection (C151.6)', () => {
  const projections = readdirSync(path.join(FIXTURES, 'api/flow-projections')).sort();

  it.each(projections)('accepts the golden projection %s', (file) => {
    const raw = read(`api/flow-projections/${file}`);
    expect(flowProjectionSchema.parse(raw)).toEqual(raw);
  });

  const base = () =>
    clone(read('api/flow-projections/branch-1-consent.json')) as Json & { steps: Json[] };

  it('carries no transition and no v2 member', () => {
    const transition = base();
    transition.transitions = [{ from: 'consent', to: 'id_card' }];
    expect(flowProjectionSchema.safeParse(transition).success).toBe(false);
    const member = base();
    at(member.steps, 1).onFallback = 'review';
    expect(flowProjectionSchema.safeParse(member).success).toBe(false);
    const form = base();
    form.steps.splice(1, 0, { id: 'about', type: 'form', fields: [] });
    expect(flowProjectionSchema.safeParse(form).success).toBe(false);
  });

  it('ends at its first terminal step or placeholder, numbered continue-1', () => {
    const after = base();
    after.steps.push({ id: 'done', type: 'completion' });
    expect(flowProjectionSchema.safeParse(after).success).toBe(false);
    const open = base();
    open.steps.pop();
    expect(flowProjectionSchema.safeParse(open).success).toBe(false);
    const numbered = base();
    at(numbered.steps, 2).id = 'continue-2';
    expect(flowProjectionSchema.safeParse(numbered).success).toBe(false);
    expect(SERVER_CONTINUATION_STEP_TYPE).toBe('server-continuation');
  });

  it('names, for every golden projection, the v2 flow and the position it projects', () => {
    const cases = (
      read('flows/v2/projection-cases.json') as { cases: { projection: string; flow: string }[] }
    ).cases;
    expect(
      cases.map((entry) => entry.projection.replace('api/flow-projections/', '')).sort(),
    ).toEqual(projections);
    for (const entry of cases) {
      expect(flowV2Schema.safeParse(read(entry.flow)).success, entry.flow).toBe(true);
    }
  });
});

describe('the client view (C151.5, review P14)', () => {
  const screen = () => {
    const step = clone(stepOf(everyStep(), 'about_you'));
    delete step.name;
    return step;
  };

  it('is an allowlist: a screen without its name, a v1 step without its v2 internals', () => {
    expect(clientStepViewSchema.safeParse(screen()).success).toBe(true);
    expect(clientStepViewSchema.safeParse({ ...screen(), name: 'About you' }).success).toBe(false);
    const gid = clone(stepOf(everyStep(), 'id_card'));
    expect(clientStepViewSchema.safeParse(gid).success).toBe(false);
    delete gid.onFallback;
    expect(clientStepViewSchema.safeParse(gid).success).toBe(true);
    const phone = clone(stepOf(everyStep(), 'phone_check'));
    expect(clientStepViewSchema.safeParse(phone).success).toBe(false);
  });

  it('never carries a branch or an action', () => {
    expect(clientStepViewSchema.safeParse(stepOf(everyStep(), 'age_route')).success).toBe(false);
    expect(clientStepViewSchema.safeParse(stepOf(everyStep(), 'screening')).success).toBe(false);
  });
});

describe('versions (C147.1, C147.8)', () => {
  it('are 1 and 2, and version 1 is today flowSchema, unchanged', () => {
    expect(FLOW_SPEC_VERSIONS).toEqual([1, 2]);
    expect(flowV1Schema).toBe(flowSchema);
  });

  it('parses either version, dispatching on specVersion', () => {
    const v1 = read('api/flow-projections/linear-4-done.json');
    expect(isFlowV2(parseAnyFlow(v1))).toBe(false);
    const v2 = parseAnyFlow(everyStep());
    expect(isFlowV2(v2)).toBe(true);
    expect(safeParseAnyFlow(everyStep())).toMatchObject({ success: true, version: 2 });
  });

  it('answers an unknown version at its pointer', () => {
    expect(safeParseAnyFlow({ metadata: { specVersion: 3 } })).toEqual({
      success: false,
      issues: [
        {
          pointer: '/metadata/specVersion',
          path: 'metadata.specVersion',
          message: 'specVersion must be one of 1, 2',
        },
      ],
    });
    expect(safeParseAnyFlow(null).success).toBe(false);
    expect(() => parseAnyFlow({ metadata: 'v2' })).toThrow('The flow definition is invalid');
  });

  it('reports each issue by RFC 6901 pointer, keeping the dotted path', () => {
    const flow = everyStep();
    at(flow.edges, 2).port = 'sideways';
    const result = safeParseAnyFlow(flow);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.issues).toContainEqual(
      expect.objectContaining({ pointer: '/edges/2/port', path: 'edges.2.port' }),
    );
  });

  it('gives v1 issues their pointer too, escaping ~ and / (RFC 6901)', () => {
    const v1 = clone(read('api/flow-projections/linear-1-consent.json')) as Json;
    v1.transitions = [{ from: 'consent', to: 'nowhere' }];
    const result = safeParseFlow(v1);
    expect(result.success ? [] : result.issues).toContainEqual({
      pointer: '/transitions/0/to',
      path: 'transitions.0.to',
      message: 'unknown step id "nowhere"',
    });
    expect(toJsonPointer(['layout', 'a/b~c', 2])).toBe('/layout/a~1b~0c/2');
    expect(toJsonPointer([])).toBe('');
  });
});

describe('the flow scope (C150.2, C150.10)', () => {
  it('describes the extractions each verification type exposes, heuristic and beta', () => {
    expect(Object.keys(FLOW_SCOPE_EXTRACTIONS).sort()).toEqual([...VERIFICATION_STEP_TYPES].sort());
    expect(
      FLOW_SCOPE_EXTRACTIONS.government_id.map((entry: FlowScopeExtraction) => entry.attribute),
    ).toEqual(['country-code', 'id-class', 'birthdate', 'age-years', 'expiration-date']);
    expect(
      FLOW_SCOPE_EXTRACTIONS.document.map((entry: FlowScopeExtraction) => entry.attribute),
    ).toEqual(['document-type']);
    for (const entries of Object.values<readonly FlowScopeExtraction[]>(FLOW_SCOPE_EXTRACTIONS)) {
      for (const entry of entries) {
        expect(entry.stage).toBe('beta');
        expect(['H', 'R/H']).toContain(entry.tier);
      }
    }
    const pii = FLOW_SCOPE_EXTRACTIONS.government_id
      .filter((entry: FlowScopeExtraction) => entry.pii)
      .map((entry: FlowScopeExtraction) => entry.attribute);
    expect(pii).toEqual(['birthdate', 'age-years', 'expiration-date']);
  });

  it('marks every path with its root, its source and whether it is a verification outcome', () => {
    for (const description of FLOW_SCOPE_PATHS) {
      expect(SCOPE_ROOTS).toContain(description.path.split('.')[0]);
      expect(SCOPE_SOURCES).toContain(description.source);
    }
    expect(
      FLOW_SCOPE_PATHS.filter((description: ScopePathDescription) => description.outcome).map(
        (description: ScopePathDescription) => description.path,
      ),
    ).toEqual([
      'verifications.<step id>.status',
      'verifications.<step id>.attempts',
      'verifications.<step id>.attempts-remaining',
    ]);
    const byPath = new Map(
      FLOW_SCOPE_PATHS.map((description: ScopePathDescription) => [description.path, description]),
    );
    expect(byPath.get('device.kind')).toMatchObject({
      source: 'client',
      nullable: true,
      options: ['desktop-web', 'mobile-web', 'native'],
    });
    expect(byPath.get('inquiry.fields.<key>')).toMatchObject({ source: 'person', pii: true });
    expect(byPath.get('inquiry.tags')).toMatchObject({ source: 'operator' });
    expect(byPath.get('lists.<list id>.matched')).toMatchObject({ availableInFlow: false });
    expect(byPath.get('signals.<name>')).toMatchObject({
      availableInFlow: 'flow-provisional-only',
      nullable: true,
    });
    expect(byPath.get('verifications.<step id>.checks.<check>.status')).toMatchObject({
      nullable: true,
      options: ['passed', 'failed', 'not_applicable'],
      outcome: false,
    });
  });
});
