// @vitest-environment node
/**
 * C161.7 (review H26): the pseudo-locale transform lives in `@openverify/flow-spec` for tests and
 * the preview's resolve, and never reaches the hosted flow's bundle. Each build here goes to a
 * fresh directory under the system temporary folder, never `apps/flow/dist`, and writes nothing
 * (`write: false`); stylesheets are left out, since only the scripts matter.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions, type Rolldown } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

const FLOW_ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** The first letters of the en-XA accent table: present wherever the transform is bundled. */
const TRANSFORM_MARKER = 'ȦƁƇḒḖƑƓĤĪĴ';

/** A virtual entry that calls the transform, resolved from the flow's root like its own code. */
const CALLER_ID = 'virtual:openverify-calls-the-transform';
const CALLER_SOURCE =
  "import { pseudoLocalize } from '@openverify/flow-spec';\n" +
  "document.title = pseudoLocalize('en-XA', document.title);\n";

const scratch = mkdtempSync(join(tmpdir(), 'openverify-flow-bundle-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The script chunks of a production build of `input`, as the flow's Vite config resolves it. */
async function scriptsOf(input: string): Promise<string> {
  const result = await build({
    root: FLOW_ROOT,
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    resolve: {
      conditions: [
        'onnxruntime-web-use-extern-wasm',
        '@openverify/source',
        ...defaultClientConditions,
      ],
    },
    plugins: [
      {
        name: 'openverify-no-styles',
        enforce: 'pre',
        resolveId: (id) => (id === CALLER_ID ? `\0${CALLER_ID}` : null),
        load: (id) => {
          if (id === `\0${CALLER_ID}`) {
            return CALLER_SOURCE;
          }
          return id.endsWith('.css') ? '' : null;
        },
      },
    ],
    build: {
      write: false,
      outDir: mkdtempSync(join(scratch, 'out-')),
      rollupOptions: { input },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  return outputs
    .flatMap((output) => output.output)
    .map((file) => (file.type === 'chunk' ? file.code : ''))
    .join('\n');
}

describe('the pseudo-locale transform in bundles (C161.7, review H26)', () => {
  it('is bundled with the code that calls it, so its absence below means something', async () => {
    expect((await scriptsOf(CALLER_ID)).includes(TRANSFORM_MARKER)).toBe(true);
  });

  it('is absent from the hosted flow’s bundle', async () => {
    const scripts = await scriptsOf(join(FLOW_ROOT, 'index.html'));

    expect(scripts.length).toBeGreaterThan(100_000);
    expect(scripts.includes(TRANSFORM_MARKER)).toBe(false);
  });
});
