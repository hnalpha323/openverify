/**
 * The golden flows of C147.6, C147.5, C148.3, C148.4 and C152.1 (test support): one valid base
 * flow and, per rule and per case, a mutation of it with the problems it must add (by severity,
 * code and pointer), written by hand. `scripts/write-graph-goldens.ts` writes each to
 * `golden/graph/<name>.json` for the API's and the console's own tests; `graph.test.ts` checks
 * `checkFlowGraph` gives exactly those problems beyond the base flow's own. Synthetic data only.
 */
import { CHECK_REGISTRY } from '@openverify/core';
import type { FlowGraphOptions } from '../graph.js';

type Json = Record<string, unknown>;
type Mutable = Json & { entry: string; steps: Json[]; edges: Json[] };
export type ExpectedProblem = readonly ['error' | 'warning', string, string];

export interface GraphCase {
  readonly name: string;
  readonly rule: string;
  readonly description: string;
  readonly flow: Json;
  readonly options?: Partial<FlowGraphOptions>;
  /** Problems beyond the base flow's own. */
  readonly added: readonly ExpectedProblem[];
  /** Problems of the base flow that this case removes. */
  readonly removed?: readonly ExpectedProblem[];
}

const v = (path: string): Json => ({ var: path });
const input = (id: string, field: string, extra: Json = {}): Json => ({
  id,
  kind: 'text_input',
  field,
  labelKey: `${id}.label`,
  ...extra,
});
const submit = (id = 'continue', port?: string): Json => ({
  id,
  kind: 'button',
  labelKey: `${id}.button`,
  action: 'submit',
  ...(port === undefined ? {} : { port }),
});

/** The valid base: consent, a screen, an ID with a fallback, a branch, a screen, a selfie, an action. */
export function baseFlow(): Mutable {
  return {
    metadata: { specVersion: 2, id: 'graph-base', version: 1, name: 'Graph base' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      {
        id: 'details',
        type: 'screen',
        components: [
          { id: 'title', kind: 'text', variant: 'title', copyKey: 'details.title.title' },
          input('nickname', 'nickname', { pattern: '^[a-z]+$' }),
          { id: 'has_middle', kind: 'checkbox', field: 'has_middle', labelKey: 'has_middle.label' },
          input('middle_name', 'middle_name', { visibleWhen: { '!!': [v('screen.has_middle')] } }),
          submit(),
          submit('skip', 'skip'),
        ],
      },
      {
        id: 'id_card',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 2,
        captureMethods: ['camera'],
      },
      {
        id: 'proof',
        type: 'document',
        documentTypes: ['utility_bill'],
        captureMethods: ['upload'],
      },
      {
        id: 'age_route',
        type: 'branch',
        routes: [
          {
            key: 'minor',
            label: 'Under 18',
            condition: { '<': [v('verifications.id_card.age-years'), 18] },
            onNull: 'review',
          },
        ],
      },
      {
        id: 'guardian',
        type: 'screen',
        components: [input('guardian_name', 'guardian_name'), submit()],
      },
      { id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 2 },
      { id: 'tag', type: 'action', action: { kind: 'tag_inquiry', add: ['checked'] } },
      { id: 'done', type: 'completion' },
      { id: 'rejected', type: 'failure' },
    ],
    edges: [
      ['consent', 'next', 'details'],
      ['details', 'next', 'id_card'],
      ['details', 'button:skip', 'id_card'],
      ['id_card', 'next', 'age_route'],
      ['id_card', 'exhausted', 'proof'],
      ['proof', 'next', 'age_route'],
      ['age_route', 'route:minor', 'guardian'],
      ['age_route', 'else', 'face'],
      ['guardian', 'next', 'face'],
      ['face', 'next', 'tag'],
      ['tag', 'next', 'done'],
      ['tag', 'error', 'rejected'],
    ].map(([from, port, to], index) => ({ id: `e${String(index + 1)}`, from, port, to })),
  };
}

/** The base flow's own problems: what clients that declare only spec 1 cannot run (C151.7). */
export const BASE_PROBLEMS: readonly ExpectedProblem[] = [
  ['warning', 'spec1_unsupported', '/steps/1'],
  ['warning', 'spec1_unsupported', '/steps/2'],
  ['warning', 'spec1_unsupported', '/steps/4'],
  ['warning', 'spec1_unsupported', '/steps/5'],
  ['warning', 'spec1_unsupported', '/steps/7'],
];

const mutate = (change: (flow: Mutable) => void): Json => {
  const flow = baseFlow();
  change(flow);
  return flow;
};

const edgeIndex = (flow: Mutable, from: string, port: string): number =>
  flow.edges.findIndex((edge) => edge.from === from && edge.port === port);
const retarget = (flow: Mutable, from: string, port: string, to: string): void => {
  const edge = flow.edges[edgeIndex(flow, from, port)];
  if (edge !== undefined) edge.to = to;
};
const removeEdge = (flow: Mutable, from: string, port: string): void => {
  flow.edges.splice(edgeIndex(flow, from, port), 1);
};
const addEdge = (flow: Mutable, from: string, port: string, to: string): void => {
  flow.edges.push({ id: `x${String(flow.edges.length + 1)}`, from, port, to });
};
const stepOf = (flow: Mutable, id: string): Json => {
  const found = flow.steps.find((step) => step.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const componentsOf = (flow: Mutable, id: string): Json[] => stepOf(flow, id).components as Json[];

const BETA_ID_CHECK = CHECK_REGISTRY.find(
  (check) => check.verificationType === 'government_id' && check.stage === 'beta',
)?.id;
const GA_ID_CHECK = CHECK_REGISTRY.find(
  (check) => check.verificationType === 'government_id' && check.stage === 'ga',
)?.id;

const FIELDS = [
  { key: 'nickname', type: 'string', pii: false },
  { key: 'has_middle', type: 'boolean', pii: false },
  { key: 'middle_name', type: 'string', pii: true },
  { key: 'guardian_name', type: 'string', pii: true },
];

/** Every golden case, in the order the rules are written in C147.6, C147.5, C148 and C152. */
export const GRAPH_CASES: readonly GraphCase[] = [
  // Entry and endpoints -------------------------------------------------------------------------
  {
    name: 'entry-unknown',
    rule: 'C147.6 entry exists',
    description: 'The entry names no step; the rules that walk from it are not run.',
    flow: mutate((flow) => {
      flow.entry = 'nowhere';
    }),
    added: [['error', 'entry_unknown', '/entry']],
  },
  {
    name: 'edge-from-unknown',
    rule: 'C147.6 every edge endpoint exists',
    description: 'An edge leaves a step that does not exist.',
    flow: mutate((flow) => {
      addEdge(flow, 'ghost', 'next', 'done');
    }),
    added: [['error', 'edge_endpoint_unknown', '/edges/12/from']],
  },
  {
    name: 'edge-to-unknown',
    rule: 'C147.6 every edge endpoint exists',
    description: 'The action’s error edge leads to a step that does not exist.',
    flow: mutate((flow) => {
      retarget(flow, 'tag', 'error', 'ghost');
    }),
    added: [
      ['error', 'edge_endpoint_unknown', '/edges/11/to'],
      ['error', 'action_error_edge_missing', '/steps/7'],
      ['error', 'step_unreachable', '/steps/9'],
    ],
  },
  // Ports ---------------------------------------------------------------------------------------
  {
    name: 'port-exhausted-on-consent',
    rule: 'C147.4 exhausted only on verification steps',
    description: 'A consent step has no exhausted port.',
    flow: mutate((flow) => {
      addEdge(flow, 'consent', 'exhausted', 'done');
    }),
    added: [['error', 'port_invalid', '/edges/12/port']],
  },
  {
    name: 'port-route-unknown',
    rule: 'C147.4 route:<key> names a route of the branch',
    description: 'The branch has no route "nope".',
    flow: mutate((flow) => {
      addEdge(flow, 'age_route', 'route:nope', 'done');
    }),
    added: [['error', 'port_invalid', '/edges/12/port']],
  },
  {
    name: 'port-on-terminal',
    rule: 'C147.4 completion and failure have no ports',
    description: 'A completion step leads nowhere.',
    flow: mutate((flow) => {
      addEdge(flow, 'done', 'next', 'rejected');
    }),
    added: [['error', 'port_invalid', '/edges/12/port']],
  },
  {
    name: 'port-button-unknown',
    rule: 'C148.1 button:<key> names a submit button of the screen',
    description: 'The screen has no submit button with the port "ghost".',
    flow: mutate((flow) => {
      addEdge(flow, 'details', 'button:ghost', 'face');
    }),
    added: [['error', 'port_invalid', '/edges/12/port']],
  },
  {
    name: 'port-error-on-screen',
    rule: 'C147.4 error only on actions',
    description: 'A screen has no error port.',
    flow: mutate((flow) => {
      addEdge(flow, 'guardian', 'error', 'done');
    }),
    added: [['error', 'port_invalid', '/edges/12/port']],
  },
  {
    name: 'port-duplicate',
    rule: 'C147.4 each output port takes exactly one edge',
    description: 'Two edges leave the consent step’s next port.',
    flow: mutate((flow) => {
      addEdge(flow, 'consent', 'next', 'face');
    }),
    added: [['error', 'port_duplicate', '/edges/12']],
  },
  {
    name: 'port-unwired-next',
    rule: 'C147.6 next is wired on screens, consent, handoff and verification steps',
    description: 'The guardian screen’s next port has no edge, so it cannot reach an end either.',
    flow: mutate((flow) => {
      removeEdge(flow, 'guardian', 'next');
    }),
    added: [
      ['error', 'port_unwired', '/steps/5'],
      ['error', 'terminal_unreachable', '/steps/5'],
    ],
  },
  {
    name: 'port-unwired-else',
    rule: 'C147.6 else is wired on branches',
    description: 'The branch has no else edge.',
    flow: mutate((flow) => {
      removeEdge(flow, 'age_route', 'else');
    }),
    added: [['error', 'port_unwired', '/steps/4']],
  },
  {
    name: 'port-unwired-route',
    rule: 'C147.6 every route is wired',
    description: 'The branch’s route has no edge, so the guardian screen is unreachable.',
    flow: mutate((flow) => {
      removeEdge(flow, 'age_route', 'route:minor');
    }),
    added: [
      ['error', 'port_unwired', '/steps/4'],
      ['error', 'step_unreachable', '/steps/5'],
    ],
  },
  {
    name: 'port-unwired-button',
    rule: 'C148.1 each further submit button is wired',
    description: 'The skip button’s port has no edge.',
    flow: mutate((flow) => {
      removeEdge(flow, 'details', 'button:skip');
    }),
    added: [['error', 'port_unwired', '/steps/1']],
  },
  {
    name: 'action-error-edge-missing',
    rule: 'C152.1 an action always has an error edge',
    description: 'The action has no error edge, so the failure step is unreachable.',
    flow: mutate((flow) => {
      removeEdge(flow, 'tag', 'error');
    }),
    added: [
      ['error', 'action_error_edge_missing', '/steps/7'],
      ['error', 'step_unreachable', '/steps/9'],
    ],
  },
  // Reachability ---------------------------------------------------------------------------------
  {
    name: 'step-unreachable',
    rule: 'C147.6 every step is reachable from entry',
    description: 'A completion step no edge reaches.',
    flow: mutate((flow) => flow.steps.push({ id: 'orphan', type: 'completion' })),
    added: [['error', 'step_unreachable', '/steps/10']],
  },
  {
    name: 'terminal-unreachable',
    rule: 'C147.6 every step reaches a completion or failure step',
    description: 'A screen that only leads back to itself.',
    flow: mutate((flow) => {
      flow.steps.push({ id: 'limbo', type: 'screen', components: [submit()] });
      retarget(flow, 'age_route', 'route:minor', 'limbo');
      addEdge(flow, 'limbo', 'next', 'limbo');
    }),
    added: [
      ['error', 'terminal_unreachable', '/steps/10'],
      ['error', 'step_unreachable', '/steps/5'],
      ['warning', 'spec1_unsupported', '/steps/10'],
    ],
  },
  // Cycles ---------------------------------------------------------------------------------------
  {
    name: 'cycle-through-verification',
    rule: 'C147.6 cycle_not_allowed',
    description: 'The fallback document leads back to the government ID.',
    flow: mutate((flow) => {
      retarget(flow, 'proof', 'next', 'id_card');
    }),
    added: [
      ['error', 'cycle_not_allowed', '/steps/2'],
      ['error', 'cycle_not_allowed', '/steps/3'],
    ],
  },
  {
    name: 'cycle-through-screen-and-branch',
    rule: 'C147.6 a cycle through screens and branches only is allowed',
    description: 'A back button on the guardian screen returns to the branch.',
    flow: mutate((flow) => {
      componentsOf(flow, 'guardian').push(submit('back', 'back'));
      addEdge(flow, 'guardian', 'button:back', 'age_route');
    }),
    added: [],
  },
  // One step per verification type, and the order rules ------------------------------------------
  {
    name: 'verification-type-repeated',
    rule: 'C147.6 at most one step per verification type',
    description: 'A second government ID step.',
    flow: mutate((flow) => {
      flow.steps.push({
        id: 'id_again',
        type: 'government_id',
        sides: 'back',
        maxAttempts: 1,
        captureMethods: ['camera'],
      });
      retarget(flow, 'face', 'next', 'id_again');
      addEdge(flow, 'id_again', 'next', 'tag');
    }),
    added: [['error', 'verification_type_repeated', '/steps/10']],
  },
  {
    name: 'order-nfc-before-selfie',
    rule: 'C147.6 nfc after a selfie on every path',
    description: 'The NFC step comes before the selfie.',
    flow: mutate((flow) => {
      flow.steps.push({ id: 'chip', type: 'nfc', androidOnly: true });
      retarget(flow, 'age_route', 'else', 'chip');
      addEdge(flow, 'chip', 'next', 'face');
    }),
    added: [['error', 'step_order_invalid', '/steps/10']],
  },
  {
    name: 'order-nfc-after-selfie',
    rule: 'C147.6 nfc after a selfie and a government ID on every path',
    description: 'The NFC step after the selfie: valid.',
    flow: mutate((flow) => {
      flow.steps.push({ id: 'chip', type: 'nfc', androidOnly: true });
      retarget(flow, 'face', 'next', 'chip');
      addEdge(flow, 'chip', 'next', 'tag');
    }),
    added: [],
  },
  {
    name: 'order-nfc-not-after-government-id',
    rule: 'C147.6 nfc after the government ID when the flow has one',
    description: 'The skip button bypasses the government ID on the way to the selfie and NFC.',
    flow: mutate((flow) => {
      flow.steps.push({ id: 'chip', type: 'nfc', androidOnly: true });
      retarget(flow, 'details', 'button:skip', 'face');
      retarget(flow, 'face', 'next', 'chip');
      addEdge(flow, 'chip', 'next', 'tag');
    }),
    added: [['error', 'step_order_invalid', '/steps/10']],
  },
  {
    name: 'order-aamva-before-government-id',
    rule: 'C147.6 an aamva step with source government_id after a government ID',
    description: 'The skip button reaches an AAMVA check of the ID without the ID.',
    flow: mutate((flow) => {
      flow.steps.push({ id: 'licence', type: 'aamva', source: 'government_id' });
      retarget(flow, 'details', 'button:skip', 'licence');
      addEdge(flow, 'licence', 'next', 'face');
    }),
    added: [['error', 'step_order_invalid', '/steps/10']],
  },
  // Consent dominates every upload (the new publish rule) ---------------------------------------
  {
    name: 'consent-after-upload',
    rule: 'C147.6 a consent step dominates every step that uploads data',
    description: 'The screen with personal fields comes before consent.',
    flow: mutate((flow) => {
      flow.entry = 'details';
      retarget(flow, 'details', 'next', 'consent');
      retarget(flow, 'details', 'button:skip', 'consent');
      retarget(flow, 'consent', 'next', 'id_card');
    }),
    added: [['error', 'consent_not_dominating', '/steps/1']],
  },
  {
    name: 'consent-legal-notice-alternative',
    rule: 'C147.6 a dominating screen with a legal notice satisfies the rule for screens',
    description: 'A notice screen comes before the personal fields, and consent before the ID.',
    flow: mutate((flow) => {
      flow.steps.push({
        id: 'notice',
        type: 'screen',
        components: [
          { id: 'text', kind: 'text', variant: 'body', copyKey: 'notice.data-collection' },
          submit(),
        ],
      });
      flow.entry = 'notice';
      addEdge(flow, 'notice', 'next', 'details');
      retarget(flow, 'details', 'next', 'consent');
      retarget(flow, 'details', 'button:skip', 'consent');
      retarget(flow, 'consent', 'next', 'id_card');
    }),
    options: { noticeKeys: ['notice.data-collection'] },
    added: [['warning', 'spec1_unsupported', '/steps/10']],
  },
  {
    name: 'consent-notice-not-a-consent-for-verifications',
    rule: 'C147.6 only consent satisfies the rule for verification steps',
    description: 'The notice screen comes first, and no consent before the ID.',
    flow: mutate((flow) => {
      flow.steps.push({
        id: 'notice',
        type: 'screen',
        components: [
          { id: 'text', kind: 'text', variant: 'body', copyKey: 'notice.data-collection' },
          submit(),
        ],
      });
      flow.entry = 'notice';
      addEdge(flow, 'notice', 'next', 'details');
      retarget(flow, 'details', 'next', 'id_card');
      retarget(flow, 'details', 'button:skip', 'id_card');
      retarget(flow, 'consent', 'next', 'id_card');
    }),
    options: { noticeKeys: ['notice.data-collection'] },
    added: [
      ['error', 'step_unreachable', '/steps/0'],
      ['error', 'consent_not_dominating', '/steps/2'],
      ['error', 'consent_not_dominating', '/steps/3'],
      ['error', 'consent_not_dominating', '/steps/6'],
      ['warning', 'spec1_unsupported', '/steps/10'],
    ],
  },
  // Step ids --------------------------------------------------------------------------------------
  {
    name: 'step-id-reserved',
    rule: 'C151.6 continue-<n> is the projection placeholder’s id',
    description: 'A step named like the placeholder.',
    flow: mutate((flow) => {
      stepOf(flow, 'proof').id = 'continue-1';
      retarget(flow, 'id_card', 'exhausted', 'continue-1');
      const edge = flow.edges[edgeIndex(flow, 'proof', 'next')];
      if (edge !== undefined) edge.from = 'continue-1';
    }),
    added: [['error', 'step_id_reserved', '/steps/3']],
  },
  // Screens and components (C148) -----------------------------------------------------------------
  {
    name: 'screen-submit-missing',
    rule: 'C148.1 a screen has a primary submit button',
    description: 'The guardian screen has no submit button.',
    flow: mutate((flow) => {
      componentsOf(flow, 'guardian').pop();
    }),
    added: [['error', 'screen_submit_missing', '/steps/5']],
  },
  {
    name: 'button-port-duplicate',
    rule: 'C148.1 one submit button per port',
    description: 'Two buttons submit through button:skip.',
    flow: mutate((flow) => componentsOf(flow, 'details').push(submit('skip_again', 'skip'))),
    added: [['error', 'button_port_duplicate', '/steps/1/components/6']],
  },
  {
    name: 'link-field-unset',
    rule: 'C162.3 a link button opens a link field the version sets',
    description: 'A help link while the version sets no help-url.',
    flow: mutate((flow) =>
      componentsOf(flow, 'details').push({
        id: 'help',
        kind: 'button',
        labelKey: 'help.button',
        action: 'link',
        link: 'help-url',
      }),
    ),
    options: { linkFields: [] },
    added: [['error', 'link_field_unset', '/steps/1/components/6/link']],
  },
  {
    name: 'pattern-refused',
    rule: 'C148.3 pattern_refused',
    description: 'A backreference, outside the restricted grammar.',
    flow: mutate((flow) => {
      const nickname = componentsOf(flow, 'details')[1];
      if (nickname !== undefined) nickname.pattern = '(a)\\1';
    }),
    added: [['error', 'pattern_refused', '/steps/1/components/1/pattern']],
  },
  {
    name: 'visibility-scope-invalid',
    rule: 'C148.4 visibility_scope_invalid',
    description: 'A visibility rule reads a field of another screen.',
    flow: mutate((flow) => {
      const middle = componentsOf(flow, 'details')[3];
      if (middle !== undefined) middle.visibleWhen = { '!!': [v('screen.guardian_name')] };
    }),
    added: [['error', 'visibility_scope_invalid', '/steps/1/components/3/visibleWhen/!!/0/var']],
  },
  {
    name: 'visibility-rule-invalid',
    rule: 'C148.4 the strict subset',
    description: 'An enablement rule with an operator outside the subset.',
    flow: mutate((flow) => {
      const middle = componentsOf(flow, 'details')[3];
      if (middle !== undefined) middle.enabledWhen = { '<': [v('screen.nickname'), 'm'] };
    }),
    added: [['error', 'visibility_rule_invalid', '/steps/1/components/3/enabledWhen/<']],
  },
  {
    name: 'screen-components-too-many',
    rule: 'C147.5 40 components per screen, nested ones included',
    description: 'Containers holding 41 components in all.',
    flow: mutate((flow) => {
      const texts = (count: number, prefix: string): Json[] =>
        Array.from({ length: count }, (_unused, index) => ({
          id: `${prefix}${String(index)}`,
          kind: 'spacer',
          size: 's',
        }));
      componentsOf(flow, 'guardian').push({
        id: 'box',
        kind: 'container',
        direction: 'vertical',
        children: texts(38, 't'),
      });
    }),
    added: [['error', 'screen_components_too_many', '/steps/5']],
  },
  {
    name: 'container-too-deep',
    rule: 'C147.5 container nesting at most 3',
    description: 'Four containers inside one another.',
    flow: mutate((flow) => {
      const spacer = { id: 'gap', kind: 'spacer', size: 's' };
      const box = (id: string, child: Json): Json => ({
        id,
        kind: 'container',
        direction: 'vertical',
        children: [child],
      });
      componentsOf(flow, 'guardian').push(box('c1', box('c2', box('c3', box('c4', spacer)))));
    }),
    added: [
      ['error', 'container_too_deep', '/steps/5/components/2/children/0/children/0/children/0'],
    ],
  },
  {
    name: 'step-too-large',
    rule: 'C147.5 a step’s serialised config at most 16 KiB',
    description: 'A consent step with a hundred 200-character text keys.',
    flow: mutate((flow) => {
      stepOf(flow, 'consent').textKeys = Array.from(
        { length: 100 },
        (_unused, index) => `consent.${String(index).padStart(3, '0')}.${'k'.repeat(185)}`,
      );
    }),
    added: [['error', 'step_too_large', '/steps/0']],
  },
  // Fields (C148.3, C149) -------------------------------------------------------------------------
  {
    name: 'field-binding-mismatch',
    rule: 'C148.3 a component binds a field of its type',
    description: 'A text input bound to an integer field.',
    flow: baseFlow(),
    options: {
      fieldSchemas: FIELDS.map((field) =>
        field.key === 'nickname' ? { ...field, type: 'integer' } : field,
      ),
    },
    added: [['error', 'field_binding_mismatch', '/steps/1/components/1/field']],
  },
  {
    name: 'field-unknown',
    rule: 'C149.3 a component binds a declared field',
    description: 'The guardian name is not declared.',
    flow: baseFlow(),
    options: { fieldSchemas: FIELDS.filter((field) => field.key !== 'guardian_name') },
    added: [['error', 'field_unknown', '/steps/5/components/0/field']],
  },
  {
    name: 'prefill-unknown',
    rule: 'C148.7 prefillFrom names a declared field',
    description: 'A phone step prefilled from an undeclared field.',
    flow: mutate((flow) => {
      flow.steps.push({
        id: 'phone',
        type: 'phone_otp',
        allowedCountries: ['US'],
        prefillFrom: 'phone_number',
      });
      retarget(flow, 'face', 'next', 'phone');
      addEdge(flow, 'phone', 'next', 'tag');
    }),
    options: { fieldSchemas: FIELDS },
    added: [['error', 'field_unknown', '/steps/10/prefillFrom']],
  },
  // Branches and actions --------------------------------------------------------------------------
  {
    name: 'on-null-route-unknown',
    rule: 'C150.3 onNull route:<key> names a route of the branch',
    description: 'onNull names a route the branch does not have.',
    flow: mutate((flow) => {
      const route = (stepOf(flow, 'age_route').routes as Json[])[0];
      if (route !== undefined) route.onNull = 'route:ghost';
    }),
    added: [['error', 'on_null_route_unknown', '/steps/4/routes/0/onNull']],
  },
  {
    name: 'copy-extractions-source',
    rule: 'C152.3 copy_extractions reads a verification step that comes first on every path',
    description: 'The fallback document does not come before the action on every path.',
    flow: mutate((flow) => {
      flow.steps.push({
        id: 'copy',
        type: 'action',
        action: {
          kind: 'copy_extractions',
          fromStep: 'proof',
          mapping: { nickname: 'document-type' },
        },
      });
      retarget(flow, 'face', 'next', 'copy');
      addEdge(flow, 'copy', 'next', 'tag');
      addEdge(flow, 'copy', 'error', 'rejected');
    }),
    added: [
      ['error', 'action_source_invalid', '/steps/10/action/fromStep'],
      ['warning', 'spec1_unsupported', '/steps/10'],
    ],
  },
  // Warnings (never blocking) ---------------------------------------------------------------------
  {
    name: 'warning-unverified-path',
    rule: 'C147.6 a completion reachable through no verification step (review H09)',
    description: 'The skip button leads straight to completion.',
    flow: mutate((flow) => {
      retarget(flow, 'details', 'button:skip', 'done');
    }),
    added: [['warning', 'unverified_path', '/steps/8']],
  },
  {
    name: 'warning-verification-all-beta',
    rule: 'C147.6 a verification step whose required checks are all beta',
    description: 'The government ID requires only a beta check.',
    flow: baseFlow(),
    options: {
      checks: {
        government_id: {
          [BETA_ID_CHECK ?? 'missing']: { enabled: true, required: true },
          [GA_ID_CHECK ?? 'missing']: { enabled: true, required: false },
        },
      },
    },
    added: [['warning', 'verification_all_beta', '/steps/2']],
  },
  {
    name: 'warning-duplicate-collection',
    rule: 'C147.6 two steps collecting the same value without prefillFrom (review H22)',
    description:
      'The guardian screen asks for the nickname again, and a phone step follows a phone field.',
    flow: mutate((flow) => {
      componentsOf(flow, 'guardian').unshift({
        id: 'nick',
        kind: 'text_input',
        field: 'nickname',
        labelKey: 'nick.label',
      });
      componentsOf(flow, 'details').push({
        id: 'mobile',
        kind: 'phone',
        field: 'mobile',
        labelKey: 'mobile.label',
      });
      flow.steps.push({ id: 'phone', type: 'phone_otp', allowedCountries: ['US'] });
      retarget(flow, 'face', 'next', 'phone');
      addEdge(flow, 'phone', 'next', 'tag');
    }),
    added: [
      ['warning', 'duplicate_collection', '/steps/5/components/0'],
      ['warning', 'duplicate_collection', '/steps/10'],
    ],
  },
  {
    name: 'warning-revealing-ids',
    rule: 'C151.8 person-visible ids with revealing words',
    description: 'A screen and a component whose ids name a watchlist and fraud.',
    flow: mutate((flow) => {
      stepOf(flow, 'guardian').id = 'watchlist_check';
      retarget(flow, 'age_route', 'route:minor', 'watchlist_check');
      const edge = flow.edges[edgeIndex(flow, 'guardian', 'next')];
      if (edge !== undefined) edge.from = 'watchlist_check';
      const field = componentsOf(flow, 'watchlist_check')[0];
      if (field !== undefined) field.id = 'fraud_note';
    }),
    added: [
      ['warning', 'step_id_revealing', '/steps/5'],
      ['warning', 'step_id_revealing', '/steps/5/components/0'],
    ],
  },
  {
    name: 'warning-spec1-custom-consent',
    rule: 'C151.7 custom consent copy stops spec-1 clients at the first step (V11)',
    description: 'The version overrides its consent copy.',
    flow: baseFlow(),
    options: { customConsentCopy: true },
    added: [['warning', 'spec1_unsupported', '/steps/0']],
  },
  {
    name: 'warning-client-signal-right-after-consent',
    rule: 'C150.9 a branch on a client-collected signal with no screen after consent (V06)',
    description: 'A friction branch on the bot score right after consent.',
    flow: mutate((flow) => {
      flow.steps.push({
        id: 'friction',
        type: 'branch',
        routes: [
          {
            key: 'risky',
            label: 'Risky',
            condition: { '>': [v('signals.inquiry/bot_score'), 80] },
            onNull: 'else',
          },
        ],
        waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 5 },
      });
      retarget(flow, 'consent', 'next', 'friction');
      addEdge(flow, 'friction', 'route:risky', 'details');
      addEdge(flow, 'friction', 'else', 'details');
    }),
    added: [
      ['warning', 'client_signal_before_screen', '/steps/10'],
      ['warning', 'spec1_unsupported', '/steps/10'],
    ],
  },
  {
    name: 'warning-tipping-off',
    rule: 'C150.11 a route on a list or a screening signal with a visible difference',
    description: 'A list match sends the person to an extra screen.',
    flow: mutate((flow) => {
      const route = (stepOf(flow, 'age_route').routes as Json[])[0];
      if (route !== undefined)
        route.condition = { '===': [v('lists.lst_01HZZZZZZZZZZZZZZZZZZZZZZZ.matched'), true] };
    }),
    added: [['warning', 'tipping_off_route', '/steps/4/routes/0']],
  },
];
