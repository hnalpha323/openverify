/**
 * The palette (C141.4, C122.4, editor note 2.3): what "add a step" offers, built from the action
 * catalogue the API serves (`GET /workflow-actions`, 8A amendment 102) and the step types of
 * C113.2, never a hard-coded action list. An action the environment cannot run is listed "not
 * configured" with its reason (ADR 0002 §3e); one that does not serve the trigger is listed and
 * cannot be added.
 */
import { actionServesTrigger, isWorkflowTriggerType } from '@openverify/core';
import { DECISION_TEMPLATES } from '../decision-templates';
import { WORKFLOW_TRIGGER_TYPE_WORDS, wordOf } from '../workflow-words';
import type { StepTemplate } from './document-model';

/** The members of a catalogue row the palette reads. */
export interface CatalogueAction {
  readonly key: string;
  readonly version: number;
  readonly kind: string;
  readonly stage: string;
  readonly delivery: string;
  readonly adverse: string;
  /** `null` serves every trigger type (C122.3). */
  readonly triggers: readonly string[] | null;
  readonly available: boolean;
  readonly reason: string | null;
  /** `z.toJSONSchema()` of the config, which the step form is built from (C141.4). */
  readonly configSchema?: unknown;
  /** `z.toJSONSchema()` of the output with each member's PII mark (C115.3, C120.6). */
  readonly outputSchema?: unknown;
}

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly group: 'steps' | 'actions' | 'templates';
  readonly template: StepTemplate;
  /** What it is and does, in words. */
  readonly detail: string;
  readonly beta: boolean;
  /** "Not configured: …" when the environment cannot run it, else `null`. */
  readonly notConfigured: string | null;
  /** Why it cannot be added here, else `null`. */
  readonly refusal: string | null;
}

/** C122.1: what each kind of action does, in words. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  internal: 'Changes an OpenVerify object',
  egress: 'Sends data out of OpenVerify',
  compute: 'Computes a value',
  control: 'Controls the run',
};

/** C117.5: each delivery guarantee, in words. */
const DELIVERY_WORDS: Readonly<Record<string, string>> = {
  'exactly-once': 'Exactly once',
  'at-least-once': 'At least once',
  'at-most-once': 'At most once',
  pure: 'Pure: no effect outside the run',
  control: 'No effect outside the run',
};

/** C122.1, C128: an adverse action is recorded and gated like a decline. */
const ADVERSE_WORDS: Readonly<Record<string, string>> = {
  always: 'Adverse: recorded and gated as a decision.',
  'by-config': 'Adverse when its settings make it so.',
};

/** C122.5: why an action cannot run here. */
const UNAVAILABLE_WORDS: Readonly<Record<string, string>> = {
  provider_not_configured: 'Not configured: no provider is bound for it in this environment.',
  code_disabled: 'Not configured: Evaluate Code is turned off for this install.',
};

const STEP_TYPES: readonly Pick<PaletteEntry, 'id' | 'label' | 'template' | 'detail'>[] = [
  {
    id: 'step:wait-time',
    label: 'Wait for a time',
    template: { kind: 'wait-time' },
    detail: 'Waits a number of seconds, at most 30 days, before the run goes on.',
  },
  {
    id: 'step:wait-events',
    label: 'Wait for an event',
    template: { kind: 'wait-events' },
    detail: 'Waits for an event on the run’s subject, with a timeout of at most 30 days.',
  },
  {
    id: 'step:conditional',
    label: 'Conditional',
    template: { kind: 'conditional' },
    detail: 'Takes the first route whose condition holds, else the else path.',
  },
  {
    id: 'step:parallel',
    label: 'Parallel',
    template: { kind: 'parallel' },
    detail: 'Runs its branches side by side; its join waits for every branch.',
  },
  // R005 (Workflow 9D): the loops of C113.2, each with its body and after-the-loop ports.
  {
    id: 'step:loop-for-each',
    label: 'Loop over a list',
    template: { kind: 'loop-for-each' },
    detail:
      'Runs its body once for each element of a list; a body step leads back to the loop to go on.',
  },
  {
    id: 'step:loop-while',
    label: 'Loop while a condition holds',
    template: { kind: 'loop-while' },
    detail:
      'Runs its body while its condition holds, at most its number of times; an unknown value follows its on-null.',
  },
  {
    id: 'step:loop-map',
    label: 'Map a list',
    template: { kind: 'loop-map' },
    detail: 'Runs its body for each element of a list and collects a value from each.',
  },
];

const STEP_ENTRIES: readonly PaletteEntry[] = STEP_TYPES.map((entry) => ({
  ...entry,
  group: 'steps',
  beta: false,
  notConfigured: null,
  refusal: null,
}));

function humanised(key: string): string {
  const words = key.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * C128.5 (decision 51): the review-first decision templates, each added as its steps where the step
 * goes. Each reads the inquiry from an inquiry event trigger and never publishes anything.
 */
export const TEMPLATE_ENTRIES: readonly PaletteEntry[] = DECISION_TEMPLATES.map((template) => ({
  id: `template:${template.key}`,
  label: template.name,
  group: 'templates',
  template: { kind: 'decision-template', key: template.key },
  detail: `${template.description} It reads the inquiry from an inquiry event trigger; its case template, decision basis and contest route are yours to fill before a production publish.`,
  beta: false,
  notConfigured: null,
  refusal: null,
}));

/**
 * C122.3, C152.2 (Workflow 9A Stage 1a amendment 3): whether an action serves a trigger. `null`
 * serves every type but `trigger-flow`, the rule the API's graph check applies; an unknown type
 * reads the catalogue's list as is.
 */
function servesTrigger(triggers: readonly string[] | null, triggerType: string): boolean {
  if (isWorkflowTriggerType(triggerType)) {
    return actionServesTrigger(triggers?.filter(isWorkflowTriggerType) ?? null, triggerType);
  }
  return triggers === null || triggers.includes(triggerType);
}

/**
 * The triggers that run no module: the API's graph check refuses one there
 * (`module_refused_for_trigger`). KP10-15: the palette reads the trigger the draft has now, so a
 * trigger changed after the page loaded refuses or offers the modules as the check will.
 */
export const MODULELESS_TRIGGERS: ReadonlySet<string> = new Set([
  'trigger-account',
  'trigger-case',
]);

/**
 * The palette for a definition whose trigger is `triggerType`: the step types of C113.2, then
 * every catalogue row in the order the API served it.
 */
export function paletteOf(
  actions: readonly CatalogueAction[],
  triggerType: string | null,
  modules: readonly { readonly id: string; readonly name: string }[] = [],
): readonly PaletteEntry[] {
  const versions = new Map<string, number>();
  for (const action of actions) {
    versions.set(action.key, (versions.get(action.key) ?? 0) + 1);
  }
  const triggerWords = triggerType === null ? '' : wordOf(WORKFLOW_TRIGGER_TYPE_WORDS, triggerType);
  const rows = actions.map((action): PaletteEntry => {
    const name = humanised(action.key);
    const adverse = ADVERSE_WORDS[action.adverse];
    return {
      id: `action:${action.key}@${String(action.version)}`,
      label:
        (versions.get(action.key) ?? 0) > 1 ? `${name} (version ${String(action.version)})` : name,
      group: 'actions',
      template: { kind: 'action', key: action.key, version: action.version },
      detail: [
        `${action.key}, version ${String(action.version)}.`,
        `${wordOf(KIND_WORDS, action.kind)}.`,
        `${wordOf(DELIVERY_WORDS, action.delivery)}.`,
        ...(adverse === undefined ? [] : [adverse]),
      ].join(' '),
      beta: action.stage === 'beta',
      notConfigured: action.available
        ? null
        : wordOf(UNAVAILABLE_WORDS, action.reason ?? 'provider_not_configured'),
      refusal:
        triggerType === null || servesTrigger(action.triggers, triggerType)
          ? null
          : `Does not serve the trigger ${triggerWords}, so it cannot be added here.`,
    };
  });
  // R005: a module runs another workflow (C119.8); one entry per workflow the page lists.
  const moduleEntries: PaletteEntry[] =
    modules.length === 0
      ? [
          {
            id: 'step:module',
            label: 'Module (another workflow)',
            group: 'steps',
            template: { kind: 'module', workflowId: '', name: '' },
            detail: 'Runs another workflow as a step, at its latest published version.',
            beta: false,
            notConfigured: null,
            refusal:
              'No workflow is listed here to run as a module; its id can still be written in the definition.',
          },
        ]
      : modules.map((module) => ({
          id: `module:${module.id}`,
          label: `Module: ${module.name}`,
          group: 'steps',
          template: { kind: 'module', workflowId: module.id, name: module.name },
          detail: `Runs the workflow ${module.name} (${module.id}) as a step, at its latest published version.`,
          beta: false,
          notConfigured: null,
          refusal:
            triggerType !== null && MODULELESS_TRIGGERS.has(triggerType)
              ? `${triggerWords} runs no module (another workflow), so it cannot be added here.`
              : null,
        }));
  return [...STEP_ENTRIES, ...moduleEntries, ...rows];
}
