/**
 * Small readers over captured XML elements, shared by the publisher parsers: children by local
 * name, the elements at a path, and cleaned text and attributes.
 */
import type { XmlElement } from '../xml/index.js';
import { cleanText } from './normalise.js';

/** The children of `element` with local name `name`. */
export function childrenNamed(element: XmlElement | undefined, name: string): XmlElement[] {
  return element === undefined ? [] : element.children.filter((child) => child.name === name);
}

/** Every element at `path` below `element`, each step taking every child of that name. */
export function elementsAt(element: XmlElement | undefined, ...path: string[]): XmlElement[] {
  let found = element === undefined ? [] : [element];
  for (const step of path) {
    found = found.flatMap((parent) => childrenNamed(parent, step));
  }
  return found;
}

/** The first element at `path` below `element`. */
export function elementAt(
  element: XmlElement | undefined,
  ...path: string[]
): XmlElement | undefined {
  return elementsAt(element, ...path)[0];
}

/** The cleaned text of the first element at `path` (the element's own with no path), or null. */
export function textAt(element: XmlElement | undefined, ...path: string[]): string | null {
  return cleanText(elementAt(element, ...path)?.text);
}

/** The cleaned text of every element at `path`, empty ones left out. */
export function textsAt(element: XmlElement | undefined, ...path: string[]): string[] {
  return elementsAt(element, ...path).flatMap((found) => {
    const text = cleanText(found.text);
    return text === null ? [] : [text];
  });
}

/** The cleaned value of an attribute, or null. */
export function attribute(element: XmlElement | undefined, name: string): string | null {
  return element === undefined || !Object.hasOwn(element.attributes, name)
    ? null
    : cleanText(element.attributes[name]);
}

/** `true` or `false` written as an element's text or an attribute, case-insensitively; else null. */
export function booleanOf(value: string | null): boolean | null {
  const lower = value?.toLowerCase();
  return lower === 'true' ? true : lower === 'false' ? false : null;
}
