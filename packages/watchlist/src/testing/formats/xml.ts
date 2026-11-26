/**
 * A small XML writer for the publisher-format fixtures (C77.2, C77.5): elements, attributes and
 * text, escaped, with two-space indentation. It writes no DOCTYPE and no entity beyond the
 * predefined five, as the parsers' guards require of a real publication.
 */

/** An attribute value; `null` and `undefined` leave the attribute out. */
export type XmlAttributeValue = string | number | boolean | null | undefined;

/** An element with its attributes and children (elements or text). */
export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, XmlAttributeValue>>;
  readonly children: readonly (XmlElement | string)[];
}

/** Text escaped for element content (`&`, `<`, `>`). */
export function escapeXmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Text escaped for a double-quoted attribute value (`&`, `<`, `>`, `"`). */
export function escapeXmlAttribute(text: string): string {
  return escapeXmlText(text).replaceAll('"', '&quot;');
}

/** An element; `null`, `undefined` and `false` children are left out, so they can be conditional. */
export function element(
  name: string,
  attributes: Readonly<Record<string, XmlAttributeValue>> = {},
  ...children: readonly (XmlElement | string | null | undefined | false)[]
): XmlElement {
  return {
    name,
    attributes,
    children: children.filter(
      (child): child is XmlElement | string =>
        child !== null && child !== undefined && child !== false,
    ),
  };
}

/** An element holding one text value, or `null` when the value is absent. */
export function textElement(
  name: string,
  value: string | number | null | undefined,
): XmlElement | null {
  return value === null || value === undefined ? null : element(name, {}, String(value));
}

function attributesOf(node: XmlElement): string {
  return Object.entries(node.attributes)
    .filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return value !== null && value !== undefined;
    })
    .map(([key, value]) => ` ${key}="${escapeXmlAttribute(String(value))}"`)
    .join('');
}

function render(node: XmlElement, depth: number): string {
  const indent = '  '.repeat(depth);
  const open = `${indent}<${node.name}${attributesOf(node)}`;
  if (node.children.length === 0) {
    return `${open}/>`;
  }
  if (node.children.every((child) => typeof child === 'string')) {
    return `${open}>${node.children.map((child) => escapeXmlText(child)).join('')}</${node.name}>`;
  }
  const inner = node.children
    .map((child) =>
      typeof child === 'string'
        ? `${'  '.repeat(depth + 1)}${escapeXmlText(child)}`
        : render(child, depth + 1),
    )
    .join('\n');
  return `${open}>\n${inner}\n${indent}</${node.name}>`;
}

/** A document: the XML declaration and the root element, indented, with a final newline. */
export function renderXml(
  root: XmlElement,
  declaration = '<?xml version="1.0" encoding="UTF-8"?>',
): string {
  return `${declaration}\n${render(root, 0)}\n`;
}
