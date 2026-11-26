/**
 * C155.5 (Workflow 9D, fix-builder): a screen's components edited as immutable data, by keyboard
 * and single pointer first (move up, move down, into the container before it, out of its
 * container; add from the library; remove), each result checked by flow-spec's own screen schema
 * before it is offered, so the editor never makes a screen the format cannot express.
 */
import {
  COMPONENT_KINDS,
  screenStepSchema,
  type Component,
  type ComponentKind,
  type ScreenStep,
} from '@openverify/flow-spec';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';

/** Where a component is: its index in the screen, then in each container on the way. */
export type ComponentPath = readonly number[];

export interface ComponentRow {
  readonly path: ComponentPath;
  readonly component: Component;
  readonly depth: number;
}

export type ComponentMove = 'up' | 'down' | 'into' | 'out';

/** The kinds the library offers; a kind it cannot make here is listed with its reason. */
export interface LibraryEntry {
  readonly kind: ComponentKind;
  readonly refusal: string | null;
}

type Holder = Extract<Component, { children: Component[] }>;

const holds = (component: Component | undefined): component is Holder =>
  component !== undefined && (component.kind === 'container' || component.kind === 'footer');

/** The screen with `components` checked by the format's screen schema, or `null`. */
function checked(step: ScreenStep, components: readonly Component[]): ScreenStep | null {
  const parsed = screenStepSchema.safeParse({ ...step, components });
  return parsed.success ? parsed.data : null;
}

export function componentRows(step: ScreenStep): readonly ComponentRow[] {
  const rows: ComponentRow[] = [];
  const walk = (list: readonly Component[], path: ComponentPath) => {
    list.forEach((component, index) => {
      const at = [...path, index];
      rows.push({ path: at, component, depth: at.length });
      if (holds(component)) {
        walk(component.children, at);
      }
    });
  };
  walk(step.components, []);
  return rows;
}

export function componentLibrary(): readonly LibraryEntry[] {
  return COMPONENT_KINDS.map((kind) => ({
    kind,
    refusal: kind === 'image' ? FLOW_BUILDER_COPY.screen.imageRefused : null,
  }));
}

/** Every component id the screen holds. */
function idsOf(step: ScreenStep): Set<string> {
  return new Set(componentRows(step).map((row) => row.component.id));
}

function freeId(step: ScreenStep, kind: string): string {
  const taken = idsOf(step);
  for (let number = 1; ; number += 1) {
    const id = `${kind}_${String(number)}`;
    if (!taken.has(id)) return id;
  }
}

/** A new component of `kind` at its plainest, its copy keys `<step id>.<component id>.<attribute>`. */
function template(step: ScreenStep, kind: ComponentKind, fields: readonly string[]): unknown {
  const id = freeId(step, kind);
  const key = (attribute: string) => `${step.id}.${id}.${attribute}`;
  const field = fields[0] ?? id;
  const text = { id: `${id}_text`, kind: 'text', variant: 'body', copyKey: key('body') };
  const options = [{ key: 'option_1', value: 'option_1', labelKey: key('option.option_1') }];
  const form = { id, kind, field, labelKey: key('label') };
  switch (kind) {
    case 'text':
      return { id, kind, variant: 'body', copyKey: key('body') };
    case 'image':
      return null;
    case 'spacer':
      return { id, kind, size: 'm' };
    case 'container':
      return { id, kind, direction: 'vertical', children: [text] };
    case 'footer':
      return { id, kind, children: [text] };
    case 'stepper':
      return { id, kind, labelKeys: [key('label')], current: 0 };
    case 'select':
    case 'radio_group':
    case 'multi_select':
    case 'checkbox_group':
      return { ...form, options };
    case 'address':
      return {
        id,
        kind,
        labelKey: key('label'),
        fields: {
          street1: 'address_street_1',
          city: 'address_city',
          postalCode: 'address_postal_code',
          country: 'address_country_code',
        },
      };
    case 'button':
      return { id, kind, labelKey: key('button'), action: 'submit', port: id };
    default:
      return form;
  }
}

export function addComponent(
  step: ScreenStep,
  kind: ComponentKind,
  fields: readonly string[],
): ScreenStep | null {
  const component = template(step, kind, fields);
  return component === null ? null : checked(step, [...step.components, component as Component]);
}

/** The list at `parent` (the screen's own for `[]`), changed by `change`. */
function withList(
  list: readonly Component[],
  parent: ComponentPath,
  change: (siblings: Component[]) => Component[] | null,
): Component[] | null {
  if (parent.length === 0) {
    return change([...list]);
  }
  const [head, ...rest] = parent;
  const holder = head === undefined ? undefined : list[head];
  if (!holds(holder) || head === undefined) return null;
  const children = withList(holder.children, rest, change);
  if (children === null) return null;
  const next = [...list];
  next[head] = { ...holder, children };
  return next;
}

function at(list: readonly Component[], path: ComponentPath): Component | undefined {
  let current: readonly Component[] = list;
  let found: Component | undefined;
  for (const index of path) {
    found = current[index];
    current = holds(found) ? found.children : [];
  }
  return found;
}

export function moveComponent(
  step: ScreenStep,
  path: ComponentPath,
  move: ComponentMove,
): ScreenStep | null {
  const index = path.at(-1);
  const parent = path.slice(0, -1);
  const moving = at(step.components, path);
  if (index === undefined || moving === undefined) return null;
  let components: Component[] | null;
  switch (move) {
    case 'up':
    case 'down':
      components = withList(step.components, parent, (siblings) => {
        const other = move === 'up' ? index - 1 : index + 1;
        const swapped = siblings[other];
        if (swapped === undefined) return null;
        siblings[other] = moving;
        siblings[index] = swapped;
        return siblings;
      });
      break;
    case 'into':
      components = withList(step.components, parent, (siblings) => {
        const before = siblings[index - 1];
        if (!holds(before)) return null;
        siblings[index - 1] = { ...before, children: [...before.children, moving] };
        siblings.splice(index, 1);
        return siblings;
      });
      break;
    case 'out': {
      const parentIndex = parent.at(-1);
      if (parentIndex === undefined) return null;
      components = withList(step.components, parent.slice(0, -1), (siblings) => {
        const holder = siblings[parentIndex];
        if (!holds(holder)) return null;
        siblings[parentIndex] = {
          ...holder,
          children: holder.children.filter((_child, child) => child !== index),
        };
        siblings.splice(parentIndex + 1, 0, moving);
        return siblings;
      });
      break;
    }
  }
  return components === null ? null : checked(step, components);
}

export function removeComponent(step: ScreenStep, path: ComponentPath): ScreenStep | null {
  const index = path.at(-1);
  if (index === undefined) return null;
  const components = withList(step.components, path.slice(0, -1), (siblings) =>
    index < siblings.length ? siblings.filter((_sibling, sibling) => sibling !== index) : null,
  );
  return components === null ? null : checked(step, components);
}

export function replaceComponent(
  step: ScreenStep,
  path: ComponentPath,
  next: Component,
): ScreenStep | null {
  const index = path.at(-1);
  if (index === undefined) return null;
  const components = withList(step.components, path.slice(0, -1), (siblings) => {
    if (index >= siblings.length) return null;
    siblings[index] = next;
    return siblings;
  });
  return components === null ? null : checked(step, components);
}
