/**
 * What a server component tree sends to the browser in its RSC payload, as text a test can
 * search: "no value the API masked reaches the RSC payload from another source" (C31.6, C37).
 *
 * React's Flight protocol sends what server components render (host elements with their props,
 * and text) and, for each client component, every prop it is given, whether or not it renders
 * it. A server component's own props stay on the server. `rscPayloadOf` walks a tree the same
 * way: it calls each server component (inside a throwaway render, so the hooks React allows on
 * the server, such as `useId`, work) and records host element props, text, and every prop of a
 * client component, walking the elements found among them.
 *
 * Client components are the exports of every `'use client'` module under `src/components`, and
 * the framework's and the UI package's (`next/link`, `@openverify/ui`'s fields). Anything else
 * that is not a plain function component (a `memo` or `forwardRef` object) counts as a client
 * component too, so its props are recorded rather than missed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Field, Input } from '@openverify/ui';
import Link from 'next/link';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const COMPONENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'components');
const CLIENT_DIRECTIVE = /^\s*['"]use client['"]/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

let clientComponents: Promise<ReadonlySet<unknown>> | undefined;

/** The exports of every `'use client'` module, and the framework's client components. */
function loadClientComponents(): Promise<ReadonlySet<unknown>> {
  clientComponents ??= (async () => {
    const found = new Set<unknown>([Link, Field, Input]);
    for (const file of sourceFiles(COMPONENTS_DIR)) {
      if (!CLIENT_DIRECTIVE.test(readFileSync(file, 'utf8'))) {
        continue;
      }
      const module = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const value of Object.values(module)) {
        found.add(value);
      }
    }
    return found;
  })();
  return clientComponents;
}

/** Calls a server component inside a render, where hooks such as `useId` may run. */
function callServerComponent(component: (props: unknown) => unknown, props: unknown): unknown {
  const result: { output?: unknown; failure?: { readonly error: unknown } } = {};
  function Probe() {
    try {
      result.output = component(props);
    } catch (error) {
      result.failure = { error };
    }
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (result.failure !== undefined) {
    throw result.failure.error;
  }
  return result.output;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

/** The props as Flight serializes them; the elements among them are walked after. */
function serializeProps(props: unknown, elements: unknown[]): string {
  return JSON.stringify(props, (_key, value: unknown) => {
    if (
      isValidElement(value) ||
      (Array.isArray(value) && (value as unknown[]).some((item) => isValidElement(item)))
    ) {
      elements.push(value);
      return '[element]';
    }
    if (typeof value === 'function') {
      return '[function]';
    }
    return value;
  });
}

async function walk(node: unknown, out: string[], clients: ReadonlySet<unknown>): Promise<void> {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return;
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      await walk(child, out, clients);
    }
    return;
  }
  if (isThenable(node)) {
    await walk(await node, out, clients);
    return;
  }
  if (!isValidElement(node)) {
    out.push(JSON.stringify(node));
    return;
  }
  const { type, props } = node;
  if (typeof type === 'function' && !clients.has(type)) {
    await walk(callServerComponent(type as (props: unknown) => unknown, props), out, clients);
    return;
  }
  // A host element, a fragment or a client component: its props travel with it.
  const elements: unknown[] = [];
  out.push(serializeProps(props, elements));
  for (const element of elements) {
    await walk(element, out, clients);
  }
}

/** The text of everything `node` would put in the RSC payload. */
export async function rscPayloadOf(node: ReactNode): Promise<string> {
  const out: string[] = [];
  await walk(node, out, await loadClientComponents());
  return out.join('\n');
}
