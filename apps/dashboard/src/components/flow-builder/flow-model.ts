/**
 * The flow builder's document model (C155.1-C155.3): flow-spec v2 edited as immutable data. Every
 * edit returns a new flow; ids are opaque and generated (C151.8: step ids are visible to the person,
 * so a name lives in `name`, never in the id); every connection runs one rule
 * (`connectionProblem`), so the outline, the canvas and the palette never offer a graph the format
 * cannot express (C147.4, C147.6's cycle rule, C155.11). The API's graph check stays the authority
 * at save and publish.
 */
import {
  FLOW_V2_STEP_TYPES,
  VERIFICATION_STEP_TYPES,
  stepV2Schema,
  type FlowV2,
  type FlowV2Edge,
  type FlowV2Step,
  type FlowV2StepType,
} from '@openverify/flow-spec';
import { tidyGraph } from '../graph-editor/layout';

/** C151.8: `s_` and 8 base32 characters (an edge: `e_`). */
export const OPAQUE_STEP_ID = /^s_[a-z2-7]{8}$/;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Every v2 step type (C147.3). `form` is a v1 type only: v2 has no form step (a v1 form migrates
 * to a screen of form components, C147.10), so the palette never offers it.
 */
export const BUILDER_STEP_TYPES: readonly FlowV2StepType[] = FLOW_V2_STEP_TYPES;

/** The step types a person never sees and that never loop through a verification (C147.6). */
const CYCLE_TYPES: ReadonlySet<string> = new Set(['screen', 'branch']);

const VERIFICATION_TYPES: ReadonlySet<string> = new Set(VERIFICATION_STEP_TYPES);

/**
 * An opaque id, `<prefix>_` and 8 base32 characters from `random` (each draw in [0, 1)), drawn
 * again while `taken` holds it.
 */
export function opaqueId(
  prefix: 's' | 'e',
  random: () => number,
  taken: ReadonlySet<string>,
): string {
  for (;;) {
    let id = `${prefix}_`;
    for (let index = 0; index < 8; index += 1) {
      id += BASE32[Math.min(BASE32.length - 1, Math.floor(random() * BASE32.length))] ?? 'a';
    }
    if (!taken.has(id)) {
      return id;
    }
  }
}

/** Every id the flow holds (steps and edges), so a generated one is new. */
export function idsOf(flow: FlowV2): Set<string> {
  return new Set([...flow.steps.map((step) => step.id), ...flow.edges.map((edge) => edge.id)]);
}

/**
 * A new step of `type` with the format's required members at their plainest values (the default
 * template's where it has them); the author changes them in the step's form.
 */
export function stepTemplate(type: FlowV2StepType, id: string): FlowV2Step {
  const members: Readonly<Record<FlowV2StepType, Readonly<Record<string, unknown>>>> = {
    consent: {
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      required: true,
    },
    government_id: { sides: 'both', maxAttempts: 3, captureMethods: ['upload', 'camera'] },
    selfie: { poses: ['center'], liveness: 'passive', maxAttempts: 3 },
    document: {
      documentTypes: ['utility_bill'],
      captureMethods: ['upload', 'camera'],
      maxAttempts: 3,
    },
    phone_otp: { allowedCountries: ['US'] },
    email_otp: {},
    database: { fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'] },
    aamva: { source: 'government_id' },
    nfc: { androidOnly: true },
    crypto_wallet: { chains: ['eip155:1'], signing: ['wallet'] },
    database_business: {},
    business_website: {},
    device_handoff: {},
    completion: {},
    failure: {},
    screen: {
      components: [
        { id: 'continue', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    },
    branch: { routes: [{ key: 'route_1', label: 'Route 1', condition: {} }] },
    action: { action: { kind: 'flag_for_review', reasonCode: 'flow_review' } },
    // C238.1 (Workflow 11A): the destination side needs no connection id; the author names the
    // withdrawal contact, which publish requires.
    share_consent: { side: 'destination' },
  };
  return stepV2Schema.parse({ id, type, ...members[type] });
}

/** A screen's further submit buttons: each exits through its `button:<key>` port (C148.1). */
function buttonPorts(step: FlowV2Step): string[] {
  if (step.type !== 'screen') {
    return [];
  }
  const ports: string[] = [];
  const visit = (components: readonly unknown[]): void => {
    for (const component of components) {
      if (typeof component !== 'object' || component === null) {
        continue;
      }
      const record = component as Readonly<Record<string, unknown>>;
      if (
        record.kind === 'button' &&
        record.action === 'submit' &&
        typeof record.port === 'string' &&
        !ports.includes(`button:${record.port}`)
      ) {
        ports.push(`button:${record.port}`);
      }
      if (Array.isArray(record.children)) {
        visit(record.children as readonly unknown[]);
      }
    }
  };
  visit(step.components);
  return ports;
}

/** Every output port of a step, in order (C147.4); `completion` and `failure` have none. */
export function stepPorts(step: FlowV2Step): readonly string[] {
  switch (step.type) {
    case 'completion':
    case 'failure':
      return [];
    case 'branch':
      return [...step.routes.map((route) => `route:${route.key}`), 'else'];
    case 'action':
      return ['next', 'error'];
    case 'screen':
      return ['next', ...buttonPorts(step)];
    default:
      return VERIFICATION_TYPES.has(step.type) ? ['next', 'exhausted'] : ['next'];
  }
}

/**
 * The ports that must take an edge (C147.6): `next` on screens, consent, handoff and verification
 * steps, each further button of a screen, `else` on a branch, `next` and `error` on an action.
 * `exhausted` and a route are optional (an unwired route is never taken).
 */
export function requiredStepPorts(step: FlowV2Step): readonly string[] {
  return stepPorts(step).filter((port) => port !== 'exhausted' && !port.startsWith('route:'));
}

export function stepOf(flow: FlowV2, id: string): FlowV2Step | undefined {
  return flow.steps.find((step) => step.id === id);
}

/** The one edge on a port, if any. */
export function edgeOnPort(flow: FlowV2, from: string, port: string): FlowV2Edge | undefined {
  return flow.edges.find((edge) => edge.from === from && edge.port === port);
}

/** The steps reachable from `from` along the flow's edges, `from` included. */
function reachable(edges: readonly FlowV2Edge[], from: string): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    for (const edge of edges) {
      if (edge.from === current && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

export type ConnectionProblem =
  'source_unknown' | 'port_unknown' | 'target_unknown' | 'self' | 'cycle_not_allowed';

/**
 * Why `from`'s `port` may not lead to `to`, or `null` when it may: the source, port and target
 * exist, the target is another step, and a cycle the connection makes runs only through screens
 * and branches (C147.6: "go back and correct the form"; a verification, consent, handoff or action
 * is entered once).
 */
export function connectionProblem(
  flow: FlowV2,
  from: string,
  port: string,
  to: string,
): ConnectionProblem | null {
  const source = stepOf(flow, from);
  if (source === undefined) {
    return 'source_unknown';
  }
  if (!stepPorts(source).includes(port)) {
    return 'port_unknown';
  }
  if (stepOf(flow, to) === undefined) {
    return 'target_unknown';
  }
  if (to === from) {
    return 'self';
  }
  const edges = flow.edges.filter((edge) => !(edge.from === from && edge.port === port));
  const forward = reachable(edges, to);
  if (!forward.has(from)) {
    return null;
  }
  // The new edge closes a cycle: every step on a path from `to` back to `from` is on it.
  const onCycle = [...forward].filter((id) => reachable(edges, id).has(from));
  return onCycle.every((id) => CYCLE_TYPES.has(stepOf(flow, id)?.type ?? ''))
    ? null
    : 'cycle_not_allowed';
}

export function canConnectFlow(flow: FlowV2, from: string, port: string, to: string): boolean {
  return connectionProblem(flow, from, port, to) === null;
}

/** The targets `from`'s `port` may lead to, in the flow's step order. */
export function validFlowTargets(flow: FlowV2, from: string, port: string): readonly string[] {
  return flow.steps.map((step) => step.id).filter((id) => canConnectFlow(flow, from, port, id));
}

/** `from`'s `port` now leads to `to`, by the edge `edgeId`; the edge there before is replaced. */
export function connectFlowPort(
  flow: FlowV2,
  from: string,
  port: string,
  to: string,
  edgeId: string,
): FlowV2 {
  return {
    ...flow,
    edges: [
      ...flow.edges.filter((edge) => !(edge.from === from && edge.port === port)),
      { id: edgeId, from, port, to },
    ],
  };
}

export interface Place {
  readonly from: string;
  readonly port: string;
}

/**
 * `step` added after `place`: the place's port leads to it (edge `edgeIds[0]`), and, when it has
 * a `next` port, it leads to where the place led (edge `edgeIds[1]`).
 */
export function insertStepAfter(
  flow: FlowV2,
  place: Place,
  step: FlowV2Step,
  edgeIds: readonly [string, string],
): { readonly flow: FlowV2; readonly select: string } {
  const before = edgeOnPort(flow, place.from, place.port);
  const edges = flow.edges.filter((edge) => edge !== before);
  edges.push({ id: edgeIds[0], from: place.from, port: place.port, to: step.id });
  if (before !== undefined && stepPorts(step).includes('next')) {
    edges.push({ id: edgeIds[1], from: step.id, port: 'next', to: before.to });
  }
  return { flow: { ...flow, steps: [...flow.steps, step], edges }, select: step.id };
}

/**
 * The flow without step `id` and its edges; what led into it now leads where its `next` led, and
 * a deleted entry hands the entry to its `next`. `null` when the flow would have no entry.
 */
export function deleteFlowStep(flow: FlowV2, id: string): FlowV2 | null {
  const step = stepOf(flow, id);
  if (step === undefined) {
    return flow;
  }
  const onward = edgeOnPort(flow, id, 'next')?.to;
  const entry = flow.entry === id ? onward : flow.entry;
  if (entry === undefined || flow.steps.length === 1) {
    return null;
  }
  const edges = flow.edges.flatMap((edge): FlowV2Edge[] => {
    if (edge.from === id) {
      return [];
    }
    if (edge.to === id) {
      return onward === undefined || onward === edge.from ? [] : [{ ...edge, to: onward }];
    }
    return [edge];
  });
  const layout =
    flow.layout === undefined
      ? undefined
      : Object.fromEntries(Object.entries(flow.layout).filter(([key]) => key !== id));
  return {
    ...flow,
    entry,
    steps: flow.steps.filter((candidate) => candidate.id !== id),
    edges,
    ...(layout === undefined ? {} : { layout }),
  };
}

function withStep(flow: FlowV2, id: string, change: (step: FlowV2Step) => FlowV2Step): FlowV2 {
  return { ...flow, steps: flow.steps.map((step) => (step.id === id ? change(step) : step)) };
}

/** A branch's new route, last before `else`, with no condition yet (C150.1). */
export function addBranchRoute(flow: FlowV2, branchId: string, key: string, label: string): FlowV2 {
  return withStep(flow, branchId, (step) =>
    step.type === 'branch'
      ? { ...step, routes: [...step.routes, { key, label, condition: {} }] }
      : step,
  );
}

/** A route moved one place up or down (routes are tried in order); `null` at either end. */
export function moveBranchRoute(
  flow: FlowV2,
  branchId: string,
  key: string,
  direction: 'up' | 'down',
): FlowV2 | null {
  const step = stepOf(flow, branchId);
  if (step?.type !== 'branch') {
    return null;
  }
  const index = step.routes.findIndex((route) => route.key === key);
  const other = direction === 'up' ? index - 1 : index + 1;
  const moving = step.routes[index];
  const swapped = step.routes[other];
  if (index === -1 || moving === undefined || swapped === undefined) {
    return null;
  }
  const routes = [...step.routes];
  routes[index] = swapped;
  routes[other] = moving;
  return withStep(flow, branchId, () => ({ ...step, routes }));
}

/** The step's name (screens, branches and actions have one); its opaque id never changes. */
export function setStepName(flow: FlowV2, id: string, name: string): FlowV2 {
  return withStep(flow, id, (step) =>
    step.type === 'screen' || step.type === 'branch' || step.type === 'action'
      ? { ...step, name }
      : step,
  );
}

/** The step replaced by `next`, which keeps its id. */
export function updateFlowStep(flow: FlowV2, next: FlowV2Step): FlowV2 {
  return withStep(flow, next.id, () => next);
}

/** A step placed on the canvas: the layout member only. */
/**
 * WCAG 2.5.7 (Workflow 9D): every step placed by the shared "Tidy up" layout (`tidyGraph`), the
 * single-pointer alternative to dragging steps on the canvas, as the workflow editor's (C141.3).
 */
export function tidyFlowLayout(flow: FlowV2): FlowV2 {
  const tidy = tidyGraph(
    flow.steps.map((step) => step.id),
    flow.edges,
  );
  return {
    ...flow,
    layout: Object.fromEntries(
      flow.steps.map((step) => {
        const position = tidy[step.id] ?? { x: 0, y: 0 };
        return [step.id, { x: Math.round(position.x), y: Math.round(position.y) }];
      }),
    ),
  };
}

export function placeFlowStep(
  flow: FlowV2,
  id: string,
  position: { readonly x: number; readonly y: number },
): FlowV2 {
  return { ...flow, layout: { ...flow.layout, [id]: { x: position.x, y: position.y } } };
}
