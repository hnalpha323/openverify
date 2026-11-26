/**
 * Starts the sample site's server: `node src/server/main.ts` (Node 22.18 or later strips the types).
 * Build `@openverify/node` and the page first: `pnpm turbo run build --filter=@openverify/demo-web...`.
 * It prints where it listens, never a setting's value.
 */
import { join } from 'node:path';
import { startDemoServer } from './app.ts';
import { DemoConfigError, readDemoConfig } from './config.ts';

try {
  const config = readDemoConfig(process.env, join(import.meta.dirname, '../../dist'));
  const server = await startDemoServer({ config });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  process.stdout.write(`sample site listening on http://${config.host}:${String(port)}\n`);
  const stop = (): void => {
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  process.stderr.write(
    `${error instanceof DemoConfigError ? error.message : 'the sample site could not start'}\n`,
  );
  process.exitCode = 1;
}
