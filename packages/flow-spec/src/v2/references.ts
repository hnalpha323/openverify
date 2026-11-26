/**
 * C149.6 (owner `flow-spec-logic`): where each template field is read or written, as the builder
 * shows it. Pointers are into the version's attributes (`/flow/...`, `/copy/...`): a component
 * that binds the field (write), a visibility rule or a branch condition that reads it, an action
 * that writes it (`copy_extractions`) or reads it (`run_workflow` inputs, `update_account_fields`),
 * a verification step that shows it filled (`prefillFrom`), and a copy text whose `{name}`
 * placeholder names it. Steps in order, each step's members in document order, then the copy.
 */
import { toJsonPointer } from '../flow.js';
import { boundFields, componentsOf } from './rules/components-walk.js';
import type { FlowV2 } from './schemas/flow.js';

export interface FieldReference {
  readonly pointer: string;
  readonly kind: 'component' | 'condition' | 'copy' | 'action' | 'prefill';
  readonly mode: 'read' | 'write';
}

const FIELD_PATH = /^inquiry\.fields\.([a-z][a-z0-9_]{0,63})$/;
const SCREEN_PATH = /^screen\.([a-z][a-z0-9_]{0,63})$/;
const PLACEHOLDER = /\{([a-z][a-z0-9_]{0,39})\}/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Each `var` of a rule or condition matching `pattern`, with its pointer. */
function readsOf(node: unknown, pointer: string, pattern: RegExp): [string, string][] {
  if (Array.isArray(node)) {
    return node.flatMap((item: unknown, index) =>
      readsOf(item, `${pointer}/${String(index)}`, pattern),
    );
  }
  if (!isRecord(node)) return [];
  return Object.entries(node).flatMap(([operator, raw]) => {
    const at = `${pointer}${toJsonPointer([operator])}`;
    if (operator !== 'var') return readsOf(raw, at, pattern);
    const path: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
    const field = typeof path === 'string' ? pattern.exec(path)?.[1] : undefined;
    return field === undefined ? [] : [[field, at] as [string, string]];
  });
}

const sourcePath = (value: unknown): string | null =>
  isRecord(value) && typeof value.path === 'string' ? value.path : null;

export function fieldReferences(input: {
  readonly flow: FlowV2;
  readonly copy?: unknown;
}): Readonly<Record<string, readonly FieldReference[]>> {
  const references: Record<string, FieldReference[]> = {};
  const add = (
    field: string,
    pointer: string,
    kind: FieldReference['kind'],
    mode: FieldReference['mode'],
  ): void => {
    (references[field] ??= []).push({ pointer, kind, mode });
  };
  const fieldOf = (value: unknown): string | undefined => {
    const path = sourcePath(value);
    return path === null ? undefined : FIELD_PATH.exec(path)?.[1];
  };
  input.flow.steps.forEach((step, index) => {
    const at = `/flow/steps/${String(index)}`;
    if (step.type === 'screen') {
      for (const { component, pointer } of componentsOf(step.components, at)) {
        for (const { key, member } of boundFields(component))
          add(key, `${pointer}/${member}`, 'component', 'write');
        for (const member of ['visibleWhen', 'enabledWhen'] as const) {
          for (const [field, read] of readsOf(
            component[member],
            `${pointer}/${member}`,
            SCREEN_PATH,
          )) {
            add(field, read, 'condition', 'read');
          }
        }
      }
    }
    if (step.type === 'branch') {
      step.routes.forEach((route, routeIndex) => {
        const base = `${at}/routes/${String(routeIndex)}/condition`;
        for (const [field, read] of readsOf(route.condition, base, FIELD_PATH))
          add(field, read, 'condition', 'read');
      });
    }
    if ('prefillFrom' in step && step.prefillFrom !== undefined) {
      if (typeof step.prefillFrom === 'string') {
        add(step.prefillFrom, `${at}/prefillFrom`, 'prefill', 'read');
      } else {
        for (const [inputName, field] of Object.entries(step.prefillFrom)) {
          add(field, `${at}/prefillFrom${toJsonPointer([inputName])}`, 'prefill', 'read');
        }
      }
    }
    if (step.type !== 'action') return;
    const { action } = step;
    if (action.kind === 'copy_extractions') {
      for (const field of Object.keys(action.mapping))
        add(field, `${at}/action/mapping${toJsonPointer([field])}`, 'action', 'write');
    }
    const sources =
      action.kind === 'run_workflow'
        ? [['inputs', action.inputs ?? {}] as const]
        : action.kind === 'update_account_fields'
          ? [['mapping', action.mapping] as const]
          : [];
    for (const [member, mapping] of sources) {
      for (const [name, value] of Object.entries(mapping)) {
        const field = fieldOf(value);
        if (field !== undefined)
          add(field, `${at}/action/${member}${toJsonPointer([name])}/path`, 'action', 'read');
      }
    }
  });
  const messages = isRecord(input.copy) && isRecord(input.copy.messages) ? input.copy.messages : {};
  for (const [locale, texts] of Object.entries(messages)) {
    if (!isRecord(texts)) continue;
    for (const [key, text] of Object.entries(texts)) {
      if (typeof text !== 'string') continue;
      for (const [, name] of text.matchAll(PLACEHOLDER)) {
        if (name !== undefined && Object.hasOwn(references, name)) {
          add(name, `/copy/messages${toJsonPointer([locale, key])}`, 'copy', 'read');
        }
      }
    }
  }
  return references;
}
