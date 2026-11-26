/**
 * C208.1: installs or refreshes the sandbox-only Utopia anchor, in any mode:
 *
 *   pnpm --filter @openverify/api trust:sandbox-utopia
 *
 * A thin entry over `src/operator-commands/trust-sandbox-utopia.ts` (`api-nfc`). It needs `DATABASE_URL`
 * only: the anchor and its CRL are synthetic test material and nothing is sealed, so no key is
 * read. It prints one line and exits 1 when the store refused the anchor.
 */
import { pathToFileURL } from 'node:url';
import { createDatabase } from '@openverify/db';
import { Pool } from 'pg';
import { runTrustSandboxUtopia } from '#src/operator-commands/trust-sandbox-utopia';
import { systemClock } from '#src/ports';

/* v8 ignore start -- the entry point runs against a real stack, never in CI */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve()
    .then(async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
      if (databaseUrl === '') {
        throw new Error('DATABASE_URL is required.');
      }
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await runTrustSandboxUtopia({
          db: createDatabase(pool),
          clock: systemClock,
          out: (line) => process.stdout.write(`${line}\n`),
        });
      } finally {
        await pool.end();
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
