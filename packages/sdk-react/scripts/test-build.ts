/**
 * Test support for the pack tests (never shipped, never run by the release): builds a workspace
 * package into a temporary directory the way its `build` script does, so a test packs a fresh
 * build without touching the shared `dist/` other runs read.
 *
 * - `emitTypeScript` runs the package's `tsconfig.build.json` through the TypeScript API with the
 *   workspace source condition (so a workspace dependency needs no build of its own) and without
 *   the type check (the package's `typecheck` script is the check; this keeps the test cheap). It
 *   keeps the configuration's source and declaration maps, which the pack must leave out.
 * - `buildWithVite` runs the package's own `vite.config.ts` into the directory, maps included.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCE_CONDITION } from './pack-release.js';

/**
 * The emit, run in a child Node process: the compiler then runs uninstrumented (coverage of the
 * test process would slow the contracts' declaration emit several times over, past the hang guard).
 */
const EMIT_SCRIPT = `
const { createRequire } = require('node:module');
const { join } = require('node:path');
const [packageDir, outDir, condition] = process.argv.slice(1);
const ts = createRequire(join(packageDir, 'package.json'))('typescript');
const configPath = join(packageDir, 'tsconfig.build.json');
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n'));
  },
});
if (parsed === undefined) throw new Error(configPath + ' could not be read');
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: { ...parsed.options, outDir, customConditions: [condition], noCheck: true, incremental: false },
});
const { diagnostics } = program.emit();
if (diagnostics.length > 0) {
  throw new Error(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\\n')).join('\\n'));
}
`;

/** Emits the package's build configuration into `outDir`; throws on an emit diagnostic. */
export function emitTypeScript(packageDir: string, outDir: string): void {
  execFileSync(process.execPath, ['-e', EMIT_SCRIPT, packageDir, outDir, SOURCE_CONDITION], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

interface ViteModule {
  build(config: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** Builds the package with its own `vite.config.ts` into `outDir`. */
export async function buildWithVite(packageDir: string, outDir: string): Promise<void> {
  const require = createRequire(join(packageDir, 'package.json'));
  const manifestPath = require.resolve('vite/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exports: { '.': string | { import: string } };
  };
  const entry = manifest.exports['.'];
  const entryPath = join(manifestPath, '..', typeof entry === 'string' ? entry : entry.import);
  const vite = (await import(pathToFileURL(entryPath).href)) as ViteModule;
  await vite.build({
    root: packageDir,
    configFile: join(packageDir, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
}
