// @vitest-environment node
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
/** Imported by the custom Node server (`server.ts`), which runs outside Next's server graph. */
const NODE_SERVER_MODULES = new Set(['peer-address.ts']);

const modules = readdirSync(DIRECTORY).filter(
  (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !NODE_SERVER_MODULES.has(name),
);

describe('src/lib/api (Workflow 2D K004)', () => {
  it.each(modules)(
    '%s imports server-only, so a client component importing it fails the build',
    (name) => {
      expect(readFileSync(`${DIRECTORY}${name}`, 'utf8')).toMatch(/^import 'server-only';$/m);
    },
  );
});
