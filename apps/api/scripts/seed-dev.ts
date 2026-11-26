/**
 * Seeds a development tenant: `pnpm --filter @openverify/api seed:dev [--json] [--mfa-admin]
 * [--connect]`.
 *
 * Applies pending migrations (`db:migrate`), then creates (or reuses) an organization with a sandbox and a
 * production environment, its built-in roles, one operator per role (admin, developer,
 * reviewer, viewer: OPENVERIFY_SEED_<ROLE>_EMAIL and _PASSWORD, hashed with Argon2id), the
 * default inquiry template from contracts/fixtures/flows/default-gov-id-selfie.json, and a new
 * sandbox API key with every scope. The key is printed once; only its peppered hash is stored.
 * `--mfa-admin` also enrols the admin OPENVERIFY_SEED_MFA_ADMIN_EMAIL in TOTP and prints its
 * secret once (sealed with OPENVERIFY_KEK). `--json` prints the result as one JSON object for
 * scripts (the e2e global setup reads it). `--connect` (C244.1, Workflow 11A) also seeds the sample
 * partner organisation "Example Partner" (both environments, one operator per built-in role with the
 * dev operators' passwords and `+partner` emails) and a pending connection to it with a sample
 * policy; it prints ids and emails only.
 *
 * Reads DATABASE_URL and OPENVERIFY_API_KEY_PEPPER like the API does, from the environment or
 * the repository's .env (see .env.example); C249.3: it runs as the migration role, so
 * OPENVERIFY_MIGRATION_DATABASE_URL replaces DATABASE_URL when set. Messages name variables, never
 * their values.
 */
import { createDatabase, setDefaultKeyring } from '@openverify/db';
import { Pool } from 'pg';
import { migrateDatabase, migrationRoleEnv } from '#src/migrate';
import { hashPassword } from '#src/operator-auth/index';
import { formatConnectSeedResult, seedConnectPartner } from '#src/seed/connect-seed';
import {
  DEFAULT_TEMPLATE_PATH,
  SEEDED_ROLE_KEYS,
  devSeedSettingsFromEnv,
  formatDevSeedResult,
  loadTemplateAttributes,
  openDevSeedStorage,
  parseDevSeedArgs,
  seedDevEnvironment,
} from '#src/seed/dev-seed';

async function main(): Promise<void> {
  const args = parseDevSeedArgs(process.argv.slice(2));
  const settings = devSeedSettingsFromEnv(migrationRoleEnv(process.env), {
    mfaAdmin: args.mfaAdmin,
  });
  if (settings.keyring !== undefined) {
    setDefaultKeyring(settings.keyring);
  }
  const pool = new Pool({ connectionString: settings.databaseUrl });
  // C92.3, C93.6: the sandbox network import writes its snapshot object here (S3_*).
  const storage = openDevSeedStorage(settings);
  try {
    const db = createDatabase(pool);
    // Progress goes to stderr, so `--json` prints exactly one line on stdout.
    await migrateDatabase({ db, out: (line) => process.stderr.write(`${line}\n`) });
    const result = await seedDevEnvironment({
      db,
      pepper: settings.pepper,
      admin: settings.admin,
      users: settings.users,
      mfaAdmin: settings.mfaAdmin,
      organizationName: settings.organizationName,
      template: await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH),
      watchlistSourcesDisabled: settings.watchlistSourcesDisabled,
      watchlistUnOptInAllowed: settings.watchlistUnOptInAllowed,
      networkSources: settings.networkSources,
      storage,
    });
    // C244.1: the sample partner, with the dev operators' credentials (never printed).
    const connect = args.connect
      ? await seedConnectPartner({
          db,
          sourceOrganizationId: result.organizationId,
          creatorUserId: result.admin.id,
          operators: [
            { role: 'admin' as const, ...settings.admin },
            ...SEEDED_ROLE_KEYS.map((role) => ({ role, ...settings.users[role] })),
          ],
          hasher: { hash: hashPassword },
        })
      : undefined;
    process.stdout.write(
      args.json
        ? `${JSON.stringify(connect === undefined ? result : { ...result, connect })}\n`
        : formatDevSeedResult(result) +
            (connect === undefined ? '' : formatConnectSeedResult(connect)),
    );
  } finally {
    await storage?.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
