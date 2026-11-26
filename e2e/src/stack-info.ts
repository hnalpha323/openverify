/**
 * What the global setup hands to the specs: URLs of the running stack and the seeded
 * credentials. It travels in an environment variable, which Playwright passes from the global
 * setup to its worker processes; it is never written to disk.
 */
import { z } from 'zod';

export const STACK_INFO_ENV = 'OPENVERIFY_E2E_STACK';

const credentialsSchema = z.strictObject({
  email: z.string().min(1),
  password: z.string().min(1),
});

const stackInfoSchema = z.strictObject({
  apiUrl: z.url(),
  flowUrl: z.url(),
  /**
   * C178.4 (Workflow 9A): the customer page that embeds the flow with `@openverify/js`, on
   * `127.0.0.1`; the same server answers on `localhost`, an origin no spec allows.
   */
  embedPageUrl: z.url(),
  /** On `localhost`: the WebAuthn origin of the run. */
  dashboardUrl: z.url(),
  /** Mailpit's web UI and API, where invitation email lands. */
  mailpitUrl: z.url(),
  /** The all-scope sandbox API key the dev seed printed. */
  apiKey: z.string().min(1),
  /** The seeded dashboard admin (the Phase 1 operator; also `operators.admin`). */
  admin: credentialsSchema,
  /** One seeded operator per built-in role (C15). */
  operators: z.strictObject({
    admin: credentialsSchema,
    developer: credentialsSchema,
    reviewer: credentialsSchema,
    viewer: credentialsSchema,
  }),
  /** The admin the seed enrolled in TOTP, with the secret it printed once. */
  mfaAdmin: credentialsSchema.extend({ totpSecret: z.string().min(1) }),
  /**
   * C244.1 (Workflow 11A integration-11a): the sample partner `seed:dev --connect` made, opted in
   * to inbound connections, whose operators reuse the dev operators' passwords with `+partner`
   * emails, and the pending connection from the dev organisation to it.
   */
  connect: z.strictObject({
    partnerOrganizationId: z.string().min(1),
    partnerEnvironments: z.strictObject({
      sandbox: z.string().min(1),
      production: z.string().min(1),
    }),
    seededConnectionId: z.string().min(1),
    partnerAdmin: credentialsSchema,
  }),
  /** The server API's `api` rate limit per minute (C12). */
  apiRateLimitPerMinute: z.int().positive(),
  /** The seeded default template (C7). */
  defaultTemplateId: z.string().min(1),
  environments: z.strictObject({ sandbox: z.string().min(1), production: z.string().min(1) }),
  /** For checks that only the database shows (where a file is stored). */
  databaseUrl: z.string().min(1),
  /** The run's object store, for checks that a file is really gone (C16). */
  s3: z.strictObject({
    endpoint: z.url(),
    region: z.string().min(1),
    bucket: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  }),
});

export type StackInfo = z.infer<typeof stackInfoSchema>;

/** `value` as stack info, or `undefined` when it does not describe a running stack. */
export function parseStackInfo(value: unknown): StackInfo | undefined {
  const result = stackInfoSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function encodeStackInfo(info: StackInfo): string {
  return JSON.stringify(info);
}

/** @throws {Error} when the global setup has not run, or left something unreadable. */
export function readStackInfo(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StackInfo {
  const value = env[STACK_INFO_ENV];
  if (value === undefined || value === '') {
    throw new Error(`${STACK_INFO_ENV} is not set: run the specs with \`pnpm e2e\``);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = undefined;
  }
  const result = stackInfoSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${STACK_INFO_ENV} does not describe a running stack`);
  }
  return result.data;
}
