/** A screen's components in document order, nested ones included, with pointer and depth. */
import type { Component } from '../schemas/components.js';

export interface ComponentAt {
  readonly component: Component;
  readonly pointer: string;
  /** How many containers or footers hold it (0 for a top-level component). */
  readonly depth: number;
}

export function componentsOf(components: readonly Component[], pointer: string): ComponentAt[] {
  const found: ComponentAt[] = [];
  const walk = (list: readonly Component[], at: string, depth: number): void => {
    list.forEach((component, index) => {
      const here = `${at}/${String(index)}`;
      found.push({ component, pointer: here, depth });
      if ('children' in component) walk(component.children, `${here}/children`, depth + 1);
    });
  };
  walk(components, `${pointer}/components`, 0);
  return found;
}

/** The field keys a component binds: its `field`, or an address's parts. */
export function boundFields(component: Component): { key: string; member: string }[] {
  if (component.kind === 'address') {
    return Object.entries(component.fields).flatMap(([part, key]) =>
      key === undefined ? [] : [{ key, member: `fields/${part}` }],
    );
  }
  return 'field' in component ? [{ key: component.field, member: 'field' }] : [];
}

/** The `button:<key>` ports of a screen's submit buttons. */
export function buttonPorts(components: readonly Component[]): string[] {
  return componentsOf(components, '').flatMap(({ component }) =>
    component.kind === 'button' && component.action === 'submit' && component.port !== undefined
      ? [`button:${component.port}`]
      : [],
  );
}
