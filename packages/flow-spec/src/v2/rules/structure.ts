/**
 * C147.6's structural rules (decisions 7 and 8): entry and endpoints, ports per type and their
 * wiring, reachability both ways, cycles only through screens and branches, one step per
 * verification type, the order rules on every path, consent before every upload, the reserved
 * placeholder id, and the branch and action references (C150.3, C152.1, C152.3).
 */
import { COPY_KEYS } from '../copy-keys.js';
import type { FieldSchemaInput, FlowGraphOptions } from '../graph.js';
import type { FlowV2, FlowV2Edge } from '../schemas/flow.js';
import type { FlowV2Step } from '../schemas/steps.js';
import { boundFields, buttonPorts, componentsOf } from './components-walk.js';
import { dominates, graphModelOf, reachesTerminal, type GraphModel } from './graph-model.js';
import { Problems, isVerificationType, stepPointer } from './shared.js';

/** The output ports a step defines, each `true` when it must be wired (C147.4, C147.6). */
export function portsOf(step: FlowV2Step): Map<string, boolean> {
  switch (step.type) {
    case 'completion':
    case 'failure':
      return new Map();
    case 'branch':
      return new Map([
        ...step.routes.map((route): [string, boolean] => [`route:${route.key}`, true]),
        ['else', true],
      ]);
    case 'action':
      return new Map([
        ['next', true],
        ['error', true],
      ]);
    case 'screen':
      return new Map([
        ['next', true],
        ...buttonPorts(step.components).map((port): [string, boolean] => [port, true]),
      ]);
    default: {
      const ports = new Map([['next', true]]);
      if (isVerificationType(step.type)) ports.set('exhausted', false);
      return ports;
    }
  }
}

export interface Structure {
  readonly entryKnown: boolean;
  /** The flow with only the edges that count: known endpoints, a valid port, the first per port. */
  readonly valid: FlowV2;
  readonly model: GraphModel;
}

const RESERVED_ID = /^continue-[0-9]+$/;

export function checkStructure(
  flow: FlowV2,
  options: FlowGraphOptions,
  problems: Problems,
): Structure {
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const entryKnown = steps.has(flow.entry);
  if (!entryKnown) problems.error('/entry', 'entry_unknown', 'The entry names no step of the flow');

  const validEdges: FlowV2Edge[] = [];
  const used = new Set<string>();
  flow.edges.forEach((edge, index) => {
    const at = `/edges/${String(index)}`;
    const from = steps.get(edge.from);
    let known = true;
    for (const end of ['from', 'to'] as const) {
      if (!steps.has(edge[end])) {
        problems.error(`${at}/${end}`, 'edge_endpoint_unknown', `No step "${edge[end]}"`);
        known = false;
      }
    }
    if (!known || from === undefined) return;
    if (!portsOf(from).has(edge.port)) {
      problems.error(
        `${at}/port`,
        'port_invalid',
        `A ${from.type} step has no port "${edge.port}"`,
      );
      return;
    }
    const key = `${edge.from}\u0000${edge.port}`;
    if (used.has(key)) {
      problems.error(at, 'port_duplicate', 'Each output port takes exactly one edge');
      return;
    }
    used.add(key);
    validEdges.push(edge);
  });

  const valid: FlowV2 = { ...flow, edges: validEdges };
  const model = graphModelOf(valid);
  const toTerminal = reachesTerminal(model);

  flow.steps.forEach((step, index) => {
    const at = stepPointer(index);
    const missing = [...portsOf(step)]
      .filter(([port, required]) => required && !used.has(`${step.id}\u0000${port}`))
      .map(([port]) => port);
    if (missing.includes('error')) {
      problems.error(
        at,
        'action_error_edge_missing',
        'An action needs an edge from its error port',
      );
    }
    const others = missing.filter((port) => port !== 'error');
    if (others.length > 0) {
      problems.error(at, 'port_unwired', `Ports with no edge: ${others.join(', ')}`);
    }
    if (entryKnown && !model.reachable.has(step.id)) {
      problems.error(at, 'step_unreachable', 'No path from the entry reaches this step');
    }
    if (!toTerminal.has(step.id)) {
      problems.error(
        at,
        'terminal_unreachable',
        'No path from this step reaches a completion or failure step',
      );
    }
    if (RESERVED_ID.test(step.id)) {
      problems.error(at, 'step_id_reserved', 'continue-<n> is the projection placeholder’s id');
    }
  });

  checkCycles(flow, model, problems);
  checkVerificationTypes(flow, problems);
  checkBranchesAndActions(flow, model, entryKnown, problems);
  if (entryKnown) {
    checkOrder(flow, model, problems);
    checkConsent(flow, model, options, problems);
  }
  return { entryKnown, valid, model };
}

/** Tarjan's strongly connected components over the counted edges. */
function checkCycles(flow: FlowV2, model: GraphModel, problems: Problems): void {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const cyclic = new Set<string>();
  const connect = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const { edge } of model.out.get(id) ?? []) {
      if (!index.has(edge.to)) {
        connect(edge.to);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(edge.to) ?? 0));
      } else if (onStack.has(edge.to)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(edge.to) ?? 0));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    const selfLoop = (model.out.get(id) ?? []).some(({ edge }) => edge.to === id);
    if (component.length > 1 || selfLoop) for (const member of component) cyclic.add(member);
  };
  for (const step of flow.steps) if (!index.has(step.id)) connect(step.id);
  flow.steps.forEach((step, at) => {
    if (cyclic.has(step.id) && step.type !== 'screen' && step.type !== 'branch') {
      problems.error(
        stepPointer(at),
        'cycle_not_allowed',
        'A cycle may pass only screens and branches: a verification, consent, handoff or action step is entered once',
      );
    }
  });
}

function checkVerificationTypes(flow: FlowV2, problems: Problems): void {
  const seen = new Set<string>();
  flow.steps.forEach((step, index) => {
    if (!isVerificationType(step.type)) return;
    if (seen.has(step.type)) {
      problems.error(
        stepPointer(index),
        'verification_type_repeated',
        `A flow holds one ${step.type} step at most`,
      );
    }
    seen.add(step.type);
  });
}

const dominatedByType = (flow: FlowV2, model: GraphModel, stepId: string, type: string): boolean =>
  flow.steps.some((other) => other.type === type && dominates(model, other.id, stepId));

/** C147.6: `nfc` after a selfie and a government ID; `aamva` of the ID after the ID; every path. */
function checkOrder(flow: FlowV2, model: GraphModel, problems: Problems): void {
  const hasId = flow.steps.some((step) => step.type === 'government_id');
  flow.steps.forEach((step, index) => {
    if (!model.reachable.has(step.id)) return;
    const after = (type: string): boolean => dominatedByType(flow, model, step.id, type);
    const wrong =
      (step.type === 'nfc' && (!after('selfie') || (hasId && !after('government_id')))) ||
      (step.type === 'aamva' && step.source === 'government_id' && !after('government_id'));
    if (wrong) {
      problems.error(
        stepPointer(index),
        'step_order_invalid',
        step.type === 'nfc'
          ? 'An NFC step comes after a selfie, and after the government ID, on every path'
          : 'An AAMVA check of the ID comes after the government ID on every path',
      );
    }
  });
}

/** Whether a screen collects personal data: a form component bound to a field marked PII. */
function screenUploads(step: FlowV2Step, fields: readonly FieldSchemaInput[] | undefined): boolean {
  if (step.type !== 'screen') return false;
  const pii = new Map((fields ?? []).map((field) => [field.key, field.pii]));
  return componentsOf(step.components, '').some(({ component }) =>
    // Without a declared, non-PII field the value counts as personal data (fail closed).
    boundFields(component).some(({ key }) => fields === undefined || pii.get(key) !== false),
  );
}

function noticeKeysOf(options: FlowGraphOptions): ReadonlySet<string> {
  return new Set(
    options.noticeKeys ??
      Object.entries(COPY_KEYS)
        .filter(([, definition]) => definition.legal === 'notice')
        .map(([key]) => key),
  );
}

const showsNotice = (step: FlowV2Step, notices: ReadonlySet<string>): boolean =>
  step.type === 'screen' &&
  componentsOf(step.components, '').some(
    ({ component }) => component.kind === 'text' && notices.has(component.copyKey),
  );

/**
 * The new publish rule (reviews P27, F23): a consent step dominates every step that uploads data;
 * for a screen with a personal field, a dominating screen that shows a legal notice does too.
 */
function checkConsent(
  flow: FlowV2,
  model: GraphModel,
  options: FlowGraphOptions,
  problems: Problems,
): void {
  const notices = noticeKeysOf(options);
  flow.steps.forEach((step, index) => {
    if (!model.reachable.has(step.id)) return;
    const verification = isVerificationType(step.type);
    if (!verification && !screenUploads(step, options.fieldSchemas)) return;
    const consented = dominatedByType(flow, model, step.id, 'consent');
    const noticed =
      !verification &&
      flow.steps.some(
        (other) => showsNotice(other, notices) && dominates(model, other.id, step.id),
      );
    if (!consented && !noticed) {
      problems.error(
        stepPointer(index),
        'consent_not_dominating',
        verification
          ? 'A consent step comes before this step on every path'
          : 'A consent step, or a screen with a legal notice, comes before this screen on every path',
      );
    }
  });
}

function checkBranchesAndActions(
  flow: FlowV2,
  model: GraphModel,
  entryKnown: boolean,
  problems: Problems,
): void {
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  flow.steps.forEach((step, index) => {
    const at = stepPointer(index);
    if (step.type === 'branch') {
      const keys = new Set(step.routes.map((route) => route.key));
      step.routes.forEach((route, routeIndex) => {
        const target = route.onNull?.startsWith('route:') === true ? route.onNull.slice(6) : null;
        if (target !== null && !keys.has(target)) {
          problems.error(
            `${at}/routes/${String(routeIndex)}/onNull`,
            'on_null_route_unknown',
            `The branch has no route "${target}"`,
          );
        }
      });
    }
    if (step.type === 'action' && step.action.kind === 'copy_extractions') {
      const source = steps.get(step.action.fromStep);
      const fine =
        source !== undefined &&
        isVerificationType(source.type) &&
        (!entryKnown || !model.reachable.has(step.id) || dominates(model, source.id, step.id));
      if (!fine) {
        problems.error(
          `${at}/action/fromStep`,
          'action_source_invalid',
          'copy_extractions reads a verification step that comes before it on every path',
        );
      }
    }
  });
}
