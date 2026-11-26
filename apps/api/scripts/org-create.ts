/**
 * `pnpm --filter @openverify/api org:create --name <name> --admin-email <email> [--slug <name>]
 * [--print-invitation]` (Phase 11, Workflow 11B, platform-ops; C250.5): the first organisation of
 * a production install. See `src/operator-commands/org-create.ts`.
 *
 * Reads the API's settings (`loadConfig`: DATABASE_URL, the KEK, OPENVERIFY_DASHBOARD_PUBLIC_URL,
 * OPENVERIFY_SMTP_URL and OPENVERIFY_MAIL_FROM) from the environment or the repository's .env. It
 * runs as the runtime role (Stage 1a amendment 15). Never run it as a logged Job with
 * `--print-invitation`: the link is printed only on an interactive terminal anyway.
 */
import { pathToFileURL } from 'node:url';
import { createDatabase, setDefaultKeyring } from '@openverify/db';
import { Pool } from 'pg';
import {
  ORG_CREATE_USAGE,
  parseOrgCreateArgs,
  runOrgCreate,
} from '#src/operator-commands/org-create';
import { loadConfig } from '#src/config';
import { createMailer } from '#src/mail/index';
import { systemClock } from '#src/ports';
import { DEFAULT_TEMPLATE_PATH, loadTemplateAttributes } from '#src/seed/dev-seed';

interface Io {
  stdout: { write(chunk: string): unknown; isTTY?: boolean };
  stderr: { write(chunk: string): unknown };
}

/**
 * The command. Bad arguments print the usage and answer 2 before anything connects.
 * @returns the exit code: 0 done, 1 refused (nothing written), 2 bad arguments.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: Io = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  if (parseOrgCreateArgs(argv) === null) {
    io.stderr.write(ORG_CREATE_USAGE);
    return 2;
  }
  /* v8 ignore start -- the connected run, proved through runOrgCreate's tests */
  const config = loadConfig(env);
  setDefaultKeyring(config.keyring);
  const { smtpUrl, mailFrom, dashboardPublicUrl } = config.operators;
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    return await runOrgCreate({
      db: createDatabase(pool),
      argv,
      stdout: io.stdout,
      stderr: io.stderr,
      interactive: io.stdout.isTTY === true,
      mailer: smtpUrl === undefined ? null : createMailer({ smtpUrl, from: mailFrom }),
      dashboardPublicUrl,
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      clock: systemClock,
    });
  } finally {
    setDefaultKeyring(undefined);
    await pool.end();
  }
  /* v8 ignore stop */
}

/* v8 ignore start -- the entry point, run by the package script only */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`org:create: ${(error as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}
/* v8 ignore stop */
