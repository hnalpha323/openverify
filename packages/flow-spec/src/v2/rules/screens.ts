/**
 * C148 and C147.5 on each step's content: a screen's components (their count and nesting, the
 * restricted patterns, the strict visibility rules, field bindings and their types, submit buttons
 * and links), a verification step's `prefillFrom`, and the byte caps of a step and the flow.
 */
import type { FieldSchemaInput, FlowGraphOptions } from '../graph.js';
import { compilePattern } from '../pattern/index.js';
import { FLOW_V2_CAPS } from '../schemas/common.js';
import type { Component } from '../schemas/components.js';
import type { FlowV2 } from '../schemas/flow.js';
import type { FlowV2Step } from '../schemas/steps.js';
import { checkVisibilityRule } from '../visibility.js';
import { boundFields, componentsOf } from './components-walk.js';
import { Problems, jsonBytes, stepPointer } from './shared.js';

/** C148.3: the field types each form component may bind. */
const BINDABLE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  text_input: ['string', 'email-address'],
  text_area: ['string', 'email-address'],
  masked_text: ['string', 'email-address'],
  number: ['integer', 'number'],
  date: ['date'],
  checkbox: ['boolean'],
  select: ['choices'],
  radio_group: ['choices'],
  multi_select: ['multi-choices'],
  checkbox_group: ['multi-choices'],
  country_select: ['string'],
  phone: ['string'],
  url: ['string'],
  email: ['string', 'email-address'],
  address: ['string'],
});

const PATTERNED = new Set(['text_input', 'text_area', 'masked_text']);

function checkBindings(
  component: Component,
  pointer: string,
  fields: ReadonlyMap<string, FieldSchemaInput> | null,
  problems: Problems,
): void {
  if (fields === null) return;
  const allowed = BINDABLE[component.kind] ?? [];
  for (const { key, member } of boundFields(component)) {
    const field = fields.get(key);
    if (field === undefined) {
      problems.error(
        `${pointer}/${member}`,
        'field_unknown',
        `The version declares no field "${key}"`,
      );
    } else if (!allowed.includes(field.type)) {
      problems.error(
        `${pointer}/${member}`,
        'field_binding_mismatch',
        `A ${component.kind} binds a field of type ${allowed.join(' or ')}, not ${field.type}`,
      );
    }
  }
}

function checkScreen(
  step: Extract<FlowV2Step, { type: 'screen' }>,
  index: number,
  options: FlowGraphOptions,
  fields: ReadonlyMap<string, FieldSchemaInput> | null,
  problems: Problems,
): void {
  const at = stepPointer(index);
  const all = componentsOf(step.components, at);
  const screenFields = all.flatMap(({ component }) => boundFields(component).map(({ key }) => key));
  if (all.length > FLOW_V2_CAPS.componentsPerScreen) {
    problems.error(
      at,
      'screen_components_too_many',
      `A screen holds at most ${String(FLOW_V2_CAPS.componentsPerScreen)} components, nested ones included`,
    );
  }
  const ports = new Set<string>();
  let primary = false;
  for (const { component, pointer, depth } of all) {
    if ('children' in component && depth + 1 > FLOW_V2_CAPS.containerDepth) {
      problems.error(
        pointer,
        'container_too_deep',
        `Containers nest at most ${String(FLOW_V2_CAPS.containerDepth)} deep`,
      );
    }
    if (
      PATTERNED.has(component.kind) &&
      'pattern' in component &&
      component.pattern !== undefined
    ) {
      const compiled = compilePattern(component.pattern);
      if (!compiled.ok) {
        problems.error(
          `${pointer}/pattern`,
          'pattern_refused',
          `The pattern is outside the restricted grammar (${compiled.reason})`,
        );
      }
    }
    for (const member of ['visibleWhen', 'enabledWhen'] as const) {
      const rule = component[member];
      if (rule === undefined) continue;
      for (const problem of checkVisibilityRule(rule, screenFields)) {
        problems.error(`${pointer}/${member}${problem.pointer}`, problem.code, problem.detail);
      }
    }
    checkBindings(component, pointer, fields, problems);
    if (component.kind !== 'button') continue;
    if (component.action === 'submit' && component.port === undefined) primary = true;
    if (component.action === 'submit' && component.port !== undefined) {
      if (ports.has(component.port)) {
        problems.error(
          pointer,
          'button_port_duplicate',
          `Another submit button already leaves through button:${component.port}`,
        );
      }
      ports.add(component.port);
    }
    if (
      component.link !== undefined &&
      options.linkFields !== undefined &&
      !options.linkFields.includes(component.link)
    ) {
      problems.error(
        `${pointer}/link`,
        'link_field_unset',
        `The version sets no ${component.link}`,
      );
    }
  }
  if (!primary) {
    problems.error(
      at,
      'screen_submit_missing',
      'A screen needs a submit button that leaves through next',
    );
  }
}

function checkPrefill(
  step: FlowV2Step,
  index: number,
  fields: ReadonlyMap<string, FieldSchemaInput> | null,
  problems: Problems,
): void {
  if (fields === null || !('prefillFrom' in step) || step.prefillFrom === undefined) return;
  const at = `${stepPointer(index)}/prefillFrom`;
  const entries: [string, string][] =
    typeof step.prefillFrom === 'string'
      ? [['', step.prefillFrom]]
      : Object.entries(step.prefillFrom).map(([input, key]): [string, string] => [
          `/${input}`,
          key,
        ]);
  for (const [member, key] of entries) {
    if (!fields.has(key)) {
      problems.error(`${at}${member}`, 'field_unknown', `The version declares no field "${key}"`);
    }
  }
}

export function checkContent(flow: FlowV2, options: FlowGraphOptions, problems: Problems): void {
  const fields =
    options.fieldSchemas === undefined
      ? null
      : new Map(options.fieldSchemas.map((field) => [field.key, field]));
  flow.steps.forEach((step, index) => {
    if (step.type === 'screen') checkScreen(step, index, options, fields, problems);
    checkPrefill(step, index, fields, problems);
    if (jsonBytes(step) > FLOW_V2_CAPS.stepConfigBytes) {
      problems.error(
        stepPointer(index),
        'step_too_large',
        `A step's settings are at most ${String(FLOW_V2_CAPS.stepConfigBytes / 1024)} KiB`,
      );
    }
  });
  if (jsonBytes(flow) > FLOW_V2_CAPS.flowBytes) {
    problems.error(
      '',
      'flow_too_large',
      `A flow is at most ${String(FLOW_V2_CAPS.flowBytes / 1024)} KiB`,
    );
  }
}
