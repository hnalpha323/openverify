// @vitest-environment node
/**
 * C150.1, ADR 0008 (Workflow 9D review R007): the workflow engine's condition evaluator runs on the
 * server only, so neither client bundle carries it: not the hosted flow (with its preview entry) and
 * not `@openverify/js`. The markers are error codes only the evaluator raises; a virtual entry that
 * imports `evaluateFlowCondition` shows they survive a production build, so their absence below
 * means something. Each build goes to a fresh directory under the system temporary folder and
 * writes nothing (`write: false`); stylesheets are left out, since only the scripts matter.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions, type Rolldown } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

const FLOW_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Error codes the evaluator (`packages/workflow-engine/src/expressions/evaluate.ts`) raises. */
const EVALUATOR_MARKERS = ['expression_clock_missing', 'expression_conversion_failed'] as const;

/** A virtual entry that calls the evaluator, imported by path (the flow does not depend on it). */
const CALLER_ID = 'virtual:openverify-calls-the-evaluator';
const CALLER_SOURCE =
  `import { evaluateFlowCondition } from ${JSON.stringify(
    join(REPO_ROOT, 'packages/workflow-engine/src/expressions/flow-condition.ts'),
  )};\n` + 'globalThis.openverifyEvaluate = evaluateFlowCondition;\n';

const scratch = mkdtempSync(join(tmpdir(), 'openverify-client-bundles-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The script chunks of `outputs`, joined. */
function scriptsIn(result: Awaited<ReturnType<typeof build>>): string {
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  return outputs
    .flatMap((output) => output.output)
    .map((file) => (file.type === 'chunk' ? file.code : ''))
    .join('\n');
}

/** The script chunks of a production build of `input`, as the flow's Vite config resolves it. */
async function flowScriptsOf(input: string | readonly string[]): Promise<string> {
  return scriptsIn(
    await build({
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
        rollupOptions: { input: typeof input === 'string' ? input : [...input] },
      },
    }),
  );
}

/** The scripts of `@openverify/js`, built through its own `vite.config.ts` (ESM and IIFE). */
async function embedClientScripts(): Promise<string> {
  return scriptsIn(
    await build({
      configFile: join(REPO_ROOT, 'packages/sdk-js/vite.config.ts'),
      logLevel: 'silent',
      build: { write: false, outDir: mkdtempSync(join(scratch, 'js-')), sourcemap: false },
    }),
  );
}

const carried = (scripts: string) => EVALUATOR_MARKERS.filter((marker) => scripts.includes(marker));

describe('the workflow-engine evaluator in client bundles (C150.1, ADR 0008, review R007)', () => {
  it('is bundled with the code that calls it, so its absence below means something', async () => {
    expect(carried(await flowScriptsOf(CALLER_ID))).toEqual([...EVALUATOR_MARKERS]);
  });

  it('is absent from the hosted flow’s bundle and its preview entry', async () => {
    const scripts = await flowScriptsOf([
      join(FLOW_ROOT, 'index.html'),
      join(FLOW_ROOT, 'preview.html'),
    ]);

    expect(scripts.length).toBeGreaterThan(100_000);
    expect(carried(scripts)).toEqual([]);
  });

  it('is absent from @openverify/js', async () => {
    const scripts = await embedClientScripts();

    expect(scripts).toMatch(/OpenVerify/);
    expect(carried(scripts)).toEqual([]);
  });
});
