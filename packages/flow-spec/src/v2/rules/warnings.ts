/**
 * The warnings, never blocking (C147.6, C150.9, C150.11, C151.7, C151.8): a completion reachable
 * through no verification, a verification whose required checks are all beta, a value collected
 * twice without `prefillFrom`, revealing words in ids a person sees, what clients that declare only
 * spec 1 cannot run, a branch on a client-collected signal with no screen after consent, and a
 * route on a list or a screening signal that a person would notice.
 */
import { getCheckDefinition, getSignalDefinition } from '@openverify/core';
import type { FlowGraphOptions } from '../graph.js';
import type { FlowV2 } from '../schemas/flow.js';
import { boundFields, componentsOf } from './components-walk.js';
import { dominates, type GraphModel } from './graph-model.js';
import {
  CORE_VERIFICATION_TYPES,
  Problems,
  conditionPaths,
  isPersonVisible,
  isVerificationType,
  stepPointer,
} from './shared.js';

/** An AAMVA form's inputs, as the field keys a screen would bind for them. */
const AAMVA_FORM_INPUT_FIELDS = [
  'name_first',
  'name_last',
  'birthdate',
  'identification_number',
  'issuing_authority',
  'issue_date',
  'expiration_date',
  'address_postal_code',
];

/** C151.8 (review P14): words an id a person sees should not carry. */
export const REVEALING_WORDS = Object.freeze([
  'pep',
  'sanction',
  'fraud',
  'risk',
  'watchlist',
  'flag',
]);

const revealing = (id: string): boolean =>
  id.split(/[_-]/).some((segment) => REVEALING_WORDS.some((word) => segment.startsWith(word)));

function warnUnverified(flow: FlowV2, model: GraphModel, problems: Problems): void {
  // The steps reachable from entry without passing a verification step.
  const open = new Set<string>();
  const stack = [flow.entry];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const step = model.steps.get(id);
    if (step === undefined || open.has(id) || isVerificationType(step.type)) continue;
    open.add(id);
    for (const { edge } of model.out.get(id) ?? []) stack.push(edge.to);
  }
  flow.steps.forEach((step, index) => {
    if (step.type === 'completion' && open.has(step.id)) {
      problems.warning(
        stepPointer(index),
        'unverified_path',
        'A path reaches this completion through no verification step',
      );
    }
  });
}

function warnBeta(flow: FlowV2, options: FlowGraphOptions, problems: Problems): void {
  if (options.checks === undefined) return;
  flow.steps.forEach((step, index) => {
    const type = CORE_VERIFICATION_TYPES[step.type];
    const checks = type === undefined ? undefined : options.checks?.[type];
    if (checks === undefined) return;
    const required = Object.entries(checks).filter(([, check]) => check.enabled && check.required);
    if (
      required.length > 0 &&
      required.every(([name]) => getCheckDefinition(name)?.stage === 'beta')
    ) {
      problems.warning(
        stepPointer(index),
        'verification_all_beta',
        'Every check this step requires is beta',
      );
    }
  });
}

function warnDuplicates(flow: FlowV2, problems: Problems): void {
  const bound = new Set<string>();
  const kinds = new Set<string>();
  flow.steps.forEach((step, index) => {
    if (step.type !== 'screen') return;
    for (const { component, pointer } of componentsOf(step.components, stepPointer(index))) {
      kinds.add(component.kind);
      for (const { key } of boundFields(component)) {
        if (bound.has(key)) {
          problems.warning(pointer, 'duplicate_collection', `Field "${key}" is asked for again`);
        }
        bound.add(key);
      }
    }
  });
  flow.steps.forEach((step, index) => {
    const collects =
      (step.type === 'phone_otp' && kinds.has('phone')) ||
      (step.type === 'email_otp' && kinds.has('email')) ||
      (step.type === 'database' && step.fields.some((field) => bound.has(field))) ||
      (step.type === 'aamva' &&
        step.source === 'form' &&
        AAMVA_FORM_INPUT_FIELDS.some((field) => bound.has(field)));
    if (collects && !('prefillFrom' in step && step.prefillFrom !== undefined)) {
      problems.warning(
        stepPointer(index),
        'duplicate_collection',
        'A screen already asks for a value this step collects; prefillFrom shows it filled',
      );
    }
  });
}

function warnRevealing(flow: FlowV2, problems: Problems): void {
  flow.steps.forEach((step, index) => {
    if (!isPersonVisible(step)) return;
    if (revealing(step.id)) {
      problems.warning(
        stepPointer(index),
        'step_id_revealing',
        'A person sees this id; it names something they should not be told',
      );
    }
    if (step.type !== 'screen') return;
    for (const { component, pointer } of componentsOf(step.components, stepPointer(index))) {
      if (revealing(component.id)) {
        problems.warning(
          pointer,
          'step_id_revealing',
          'A person sees this id; it names something they should not be told',
        );
      }
    }
  });
}

function warnSpec1(
  flow: FlowV2,
  model: GraphModel,
  options: FlowGraphOptions,
  problems: Problems,
): void {
  flow.steps.forEach((step, index) => {
    const fallback = (model.out.get(step.id) ?? []).some(({ edge }) => edge.port === 'exhausted');
    const unsupported =
      step.type === 'screen' ||
      step.type === 'branch' ||
      step.type === 'action' ||
      (isVerificationType(step.type) && fallback) ||
      (step.type === 'consent' && options.customConsentCopy === true);
    if (unsupported) {
      problems.warning(
        stepPointer(index),
        'spec1_unsupported',
        'Clients that declare only spec 1 (today’s Android SDK) show their unsupported screen here',
      );
    }
  });
}

const signalOf = (path: string): string | null =>
  path.startsWith('signals.') ? path.slice('signals.'.length) : null;

function branchPaths(step: FlowV2['steps'][number]): string[] {
  if (step.type !== 'branch') return [];
  return [
    ...step.routes.flatMap((route) => conditionPaths(route.condition)),
    ...(step.waitFor?.facts ?? []),
  ];
}

function warnClientSignals(flow: FlowV2, model: GraphModel, problems: Problems): void {
  const consents = flow.steps.filter((step) => step.type === 'consent').map((step) => step.id);
  const screensAfterConsent = flow.steps.filter(
    (step) =>
      step.type === 'screen' && consents.some((consent) => dominates(model, consent, step.id)),
  );
  flow.steps.forEach((step, index) => {
    if (!model.reachable.has(step.id)) return;
    const client = branchPaths(step).some((path) => {
      const name = signalOf(path);
      const definition = name === null ? undefined : getSignalDefinition(name);
      return definition !== undefined && definition.collectionTier !== 'server';
    });
    if (client && !screensAfterConsent.some((screen) => dominates(model, screen.id, step.id))) {
      problems.warning(
        stepPointer(index),
        'client_signal_before_screen',
        'A client-collected signal has no data before a screen after consent; the route’s onNull decides',
      );
    }
  });
}

/** A list's match, or a signal that reads a screening. */
const screening = (path: string): boolean => {
  if (path.startsWith('lists.')) return true;
  const name = signalOf(path);
  return name !== null && (getSignalDefinition(name)?.inputs.includes('lists') ?? false);
};

function warnTippingOff(flow: FlowV2, model: GraphModel, problems: Problems): void {
  flow.steps.forEach((step, index) => {
    if (step.type !== 'branch') return;
    const target = (port: string): string | undefined =>
      (model.out.get(step.id) ?? []).find(({ edge }) => edge.port === port)?.edge.to;
    step.routes.forEach((route, routeIndex) => {
      if (!conditionPaths(route.condition).some(screening)) return;
      if (target(`route:${route.key}`) !== target('else')) {
        problems.warning(
          `${stepPointer(index)}/routes/${String(routeIndex)}`,
          'tipping_off_route',
          'A person can notice where a list or screening result sends them; flag for review on an unchanged path instead',
        );
      }
    });
  });
}

export function checkWarnings(
  flow: FlowV2,
  model: GraphModel,
  entryKnown: boolean,
  options: FlowGraphOptions,
  problems: Problems,
): void {
  if (entryKnown) {
    warnUnverified(flow, model, problems);
    warnClientSignals(flow, model, problems);
  }
  warnBeta(flow, options, problems);
  warnDuplicates(flow, problems);
  warnRevealing(flow, problems);
  warnSpec1(flow, model, options, problems);
  warnTippingOff(flow, model, problems);
}
