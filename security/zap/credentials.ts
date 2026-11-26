/**
 * The DAST run's credentials (Phase 11, Workflow 11F, dast-11f; C283.1, C283.2, review P30), made
 * per run and revoked at its end by security/zap/run.sh:
 *
 *   prepare <run-dir>  reads the reusable e2e stack through readStackInfo() (never by printing its
 *     record), refuses any URL that is not loopback, and makes, each written to
 *     <run-dir>/credentials.json (mode 0600) as soon as it exists, so a failure part-way still
 *     revokes what was made: a sandbox API key holding every sandbox scope (expiring in two hours,
 *     loopback only), two sessions of the seeded sandbox admin (one for the dashboard API's scan, one
 *     for the console's baseline), a hosted-flow session opened by the e2e helper (startInquiry),
 *     consented, and a QR handoff that session issues, both from a documentation address of the
 *     run (C111.1). It also writes <run-dir>/openapi.json (the stack's document)
 *     and <run-dir>/facts.json (ids, URLs and the internal route's answer; no secret).
 *   refresh-key <run-dir>  replaces the run's key, which lives two hours, by a new one.
 *   refresh-users <run-dir>  signs both admin sessions out and in again (C245.1's 30-minute idle
 *     timeout ends them while the API groups before them run).
 *   revoke <run-dir>   rejects the handoff, expires every session of the run's inquiry (the handoff's
 *     redeemed sessions too), expires the key, signs both admin sessions out, then checks that each
 *     credential is refused; writes <run-dir>/revoke.json (statuses only). Exit 1 if one still works.
 *
 * Every value is synthetic. Nothing is printed but statuses; no credential reaches stdout or stderr.
 * Run with: node --experimental-transform-types --no-warnings --conditions=@openverify/source
 *   --import packages/checks/scripts/register-ts.mjs security/zap/credentials.ts <command> <run-dir>
 */
import { randomInt, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  processAlive,
  readReusableStack,
  REUSABLE_STACK_FILE,
} from '../../e2e/src/reusable-stack.js';
import { withForwardedFor } from '../../e2e/src/forwarded-for.js';
import {
  encodeStackInfo,
  readStackInfo,
  STACK_INFO_ENV,
  type StackInfo,
} from '../../e2e/src/stack-info.js';
import { phase5Template, startInquiry, typeConfig } from '../../e2e/tests/support/phase5.js';
import { dashboardRequest, signInToApi } from '../../e2e/tests/support/platform.js';

interface Credentials {
  apiUrl: string;
  flowUrl: string;
  dashboardUrl: string;
  apiKey?: { id: string; token: string };
  users: { api?: { token: string }; console?: { token: string } };
  flow?: { inquiryId: string; sessionToken: string };
  handoff?: { inquiryId: string; id: string; token: string; code: string | null };
}

const KEY_LIFETIME_SECONDS = 7_200;
const E2E_DIR = path.resolve(import.meta.dirname, '..', '..', 'e2e');
const ORGANIZATION = 'Example Verification Ltd';

async function loadStack(): Promise<StackInfo> {
  const record = await readFile(REUSABLE_STACK_FILE, 'utf8').catch(() => undefined);
  const info = readReusableStack(record, (pid) =>
    processAlive(pid, (target, signal) => process.kill(target, signal)),
  );
  process.env[STACK_INFO_ENV] = encodeStackInfo(info);
  return readStackInfo();
}

function loopback(name: string, value: string): string {
  const { hostname, protocol } = new URL(value);
  if (protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(hostname)) {
    throw new Error(`${name} is not a loopback http URL; DAST scans the local stack only`);
  }
  return value.replace(/\/$/, '');
}

async function writePrivate(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
}

async function call(
  url: string,
  init: { method: string; token?: string; body?: unknown; address?: string },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
  };
  const response = await fetch(url, {
    method: init.method,
    headers: init.address === undefined ? headers : withForwardedFor(headers, init.address),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function expectStatus(what: string, answer: { status: number }, ...wanted: number[]): void {
  if (!wanted.includes(answer.status)) {
    throw new Error(`${what} answered ${String(answer.status)}`);
  }
}

/** Every scope the API-key route's schema names (the stack's own document). */
function allScopes(spec: unknown): string[] {
  const schema = (spec as Record<string, any>).paths?.['/api/v1/api-keys']?.post?.requestBody
    ?.content?.['application/json']?.schema;
  const scopes = schema?.properties?.data?.properties?.attributes?.properties?.scopes?.items?.enum;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("the stack's /openapi.json names no API-key scopes");
  }
  return scopes as string[];
}

/** The scopes the seeded key holds (a key may grant only what its caller holds). */
async function seededScopes(info: StackInfo): Promise<string[]> {
  const listed = await call(`${info.apiUrl}/api/v1/api-keys?page[size]=100`, {
    method: 'GET',
    token: info.apiKey,
  });
  expectStatus('listing the API keys', listed, 200);
  const keys = (listed.body as { data: { attributes: Record<string, unknown> }[] }).data;
  const own = keys.find((key) => {
    const prefix = key.attributes['token-prefix'];
    return typeof prefix === 'string' && prefix !== '' && info.apiKey.startsWith(prefix);
  });
  const scopes = own?.attributes.scopes;
  if (!Array.isArray(scopes)) {
    throw new Error("the seeded key's scopes could not be read");
  }
  return scopes as string[];
}

/** A run key: every sandbox scope the seeded key may grant, two hours, loopback only. */
async function createRunKey(
  info: StackInfo,
  apiUrl: string,
  spec: unknown,
): Promise<{ id: string; token: string; scopes: number }> {
  const keyBody = (scopes: string[]) => ({
    data: {
      type: 'api-key',
      attributes: {
        name: `dast-11f-${randomUUID().slice(0, 8)}`,
        scopes,
        'expires-in-seconds': KEY_LIFETIME_SECONDS,
        'allowed-ips': ['127.0.0.1/32'],
        note: 'ZAP DAST run (Workflow 11F); revoked at its end',
      },
    },
  });
  let scopes = allScopes(spec);
  let created = await call(`${apiUrl}/api/v1/api-keys`, {
    method: 'POST',
    token: info.apiKey,
    body: keyBody(scopes),
  });
  if (created.status === 403) {
    scopes = await seededScopes(info);
    created = await call(`${apiUrl}/api/v1/api-keys`, {
      method: 'POST',
      token: info.apiKey,
      body: keyBody(scopes),
    });
  }
  expectStatus('creating the run API key', created, 201);
  const key = created.body as { data: { id: string }; meta: { token: string } };
  return { id: key.data.id, token: key.meta.token, scopes: scopes.length };
}

async function prepare(runDir: string): Promise<void> {
  const info = await loadStack();
  const credentials: Credentials = {
    apiUrl: loopback('apiUrl', info.apiUrl),
    flowUrl: loopback('flowUrl', info.flowUrl),
    dashboardUrl: loopback('dashboardUrl', info.dashboardUrl),
    users: {},
  };
  const file = path.join(runDir, 'credentials.json');
  const save = () => writePrivate(file, credentials);
  await save();
  const run = randomUUID().slice(0, 8);

  const specAnswer = await fetch(`${credentials.apiUrl}/openapi.json`);
  if (!specAnswer.ok) {
    throw new Error(`/openapi.json answered ${String(specAnswer.status)}`);
  }
  const specText = await specAnswer.text();
  await writeFile(path.join(runDir, 'openapi.json'), specText, { mode: 0o600 });
  const spec: unknown = JSON.parse(specText);

  // The API key: every sandbox scope, two hours, loopback only.
  const key = await createRunKey(info, credentials.apiUrl, spec);
  credentials.apiKey = { id: key.id, token: key.token };
  await save();

  // Two sessions of the seeded sandbox admin (no MFA is scripted, C283.1).
  credentials.users.api = { token: await signInToApi(info, info.operators.admin) };
  await save();
  credentials.users.console = { token: await signInToApi(info, info.operators.admin) };
  await save();

  // C107.7: a template with a handoff step needs the environment's display name.
  const named = await dashboardRequest(info, 'PATCH', '/settings', {
    token: credentials.users.api.token,
    body: { 'organization-display-name': ORGANIZATION },
  });
  expectStatus('naming the organisation', named, 200);

  // The hosted-flow session, opened by the e2e helper on a consent-then-handoff template.
  // The handoff spec's template (e2e/tests/handoff.spec.ts): consent, the QR handoff, the database
  // step. @openverify/contracts resolves from the e2e package, as its specs import it.
  const contracts = (await import(
    pathToFileURL(
      createRequire(path.join(E2E_DIR, 'package.json')).resolve('@openverify/contracts'),
    ).href
  )) as { DEFAULT_DATABASE_CHECKS: Parameters<typeof typeConfig>[0] };
  const template = phase5Template(
    `dast-11f-handoff-${run}`,
    [
      { id: 'handoff', type: 'device_handoff', methods: ['qr'] },
      {
        id: 'records',
        type: 'database',
        fields: [
          'name_first',
          'name_last',
          'birthdate',
          'address_street_1',
          'address_city',
          'address_postal_code',
          'address_country_code',
        ],
      },
    ] as never,
    { database: typeConfig(contracts.DEFAULT_DATABASE_CHECKS) } as never,
  );
  const inquiry = await startInquiry(info, template, `dast-11f-${run}`);
  credentials.flow = { inquiryId: inquiry.inquiryId, sessionToken: inquiry.sessionToken };
  await save();
  // The flow's own calls come from a documentation address of this run (C111.1, through the
  // stack's trusted loopback proxy), so the handoff budget per address (flow-handoffs-ip, 10 an
  // hour), which the previous run's scan spends from 127.0.0.1, never refuses the next run's issue.
  const address = `203.0.113.${String(1 + randomInt(250))}`;
  const session = await call(`${credentials.apiUrl}/api/v1/flow/session`, {
    method: 'GET',
    token: inquiry.sessionToken,
    address,
  });
  expectStatus('reading the run flow session', session, 200);
  const steps = (session.body as { flow: { steps: { type: string; textKeys?: string[] }[] } }).flow
    .steps;
  const consent = await call(`${credentials.apiUrl}/api/v1/flow/consent`, {
    method: 'POST',
    token: inquiry.sessionToken,
    address,
    body: {
      accepted: true,
      'text-keys': steps.find((step) => step.type === 'consent')?.textKeys ?? [],
      locale: 'en',
    },
  });
  expectStatus('consenting in the run flow session', consent, 200, 201, 202, 204);
  const issued = await call(`${credentials.apiUrl}/api/v1/flow/handoffs`, {
    method: 'POST',
    token: inquiry.sessionToken,
    address,
    body: { method: 'qr' },
  });
  expectStatus('issuing the run handoff', issued, 201);
  const handoff = issued.body as {
    id: string;
    'url-fragment'?: string;
    'confirmation-code'?: string;
  };
  const fragment = new URLSearchParams((handoff['url-fragment'] ?? '').replace(/^#/, ''));
  const token = fragment.get('handoff-token');
  if (token === null) {
    throw new Error('the handoff answer carried no token');
  }
  credentials.handoff = {
    inquiryId: inquiry.inquiryId,
    id: handoff.id,
    token,
    code: handoff['confirmation-code'] ?? null,
  };
  await save();

  // C250.3: does the internal route answer on the public listener?
  const internal = await fetch(
    `${credentials.apiUrl}/api/v1/internal/embed-policies/${inquiry.inquiryId}`,
  );
  await writePrivate(path.join(runDir, 'facts.json'), {
    date: new Date().toISOString().slice(0, 10),
    apiUrl: credentials.apiUrl,
    flowUrl: credentials.flowUrl,
    dashboardUrl: credentials.dashboardUrl,
    apiKeyId: credentials.apiKey.id,
    apiKeyScopes: key.scopes,
    inquiryId: inquiry.inquiryId,
    handoffId: handoff.id,
    handoffConfirmationCode: credentials.handoff.code !== null,
    internalRoute: {
      path: '/api/v1/internal/embed-policies/{inquiryId}',
      status: internal.status,
      note:
        'The e2e stack leaves OPENVERIFY_INTERNAL_LISTEN unset, so the internal routes stay on the ' +
        "public listener behind the flow server's token; C250.3 moves them off it once it is set.",
    },
  });
  process.stdout.write(
    `prepare: key ${credentials.apiKey.id} (${String(key.scopes)} scopes), 2 admin sessions, ` +
      `flow session on ${inquiry.inquiryId}, handoff ${handoff.id}; internal route ${String(internal.status)}\n`,
  );
}

/**
 * C245.1: a console session ends after 30 idle minutes, and the API scans before the dashboard group
 * and the console leave the run's admin sessions idle longer. Each is signed out and replaced.
 */
async function refreshUsers(runDir: string): Promise<void> {
  const file = path.join(runDir, 'credentials.json');
  const credentials = JSON.parse(await readFile(file, 'utf8')) as Credentials;
  const info = await loadStack();
  for (const name of ['api', 'console'] as const) {
    const old = credentials.users[name];
    if (old !== undefined) {
      await call(`${credentials.apiUrl}/api/v1/dashboard/sessions/current`, {
        method: 'DELETE',
        token: old.token,
      });
    }
    credentials.users[name] = { token: await signInToApi(info, info.operators.admin) };
    await writePrivate(file, credentials);
  }
  process.stdout.write('refresh-users: 2 admin sessions signed in again\n');
}

/**
 * The run's key lives two hours; a run of every group takes longer. The key is expired and a new
 * one with the same scopes takes its place (run.sh calls this when the API answers the key 401).
 */
async function refreshKey(runDir: string): Promise<void> {
  const file = path.join(runDir, 'credentials.json');
  const credentials = JSON.parse(await readFile(file, 'utf8')) as Credentials;
  const info = await loadStack();
  const spec: unknown = JSON.parse(await readFile(path.join(runDir, 'openapi.json'), 'utf8'));
  const old = credentials.apiKey;
  const key = await createRunKey(info, credentials.apiUrl, spec);
  credentials.apiKey = { id: key.id, token: key.token };
  await writePrivate(file, credentials);
  if (old !== undefined) {
    await call(`${credentials.apiUrl}/api/v1/api-keys/${old.id}/expire`, {
      method: 'POST',
      token: info.apiKey,
      body: { meta: { 'expires-in-seconds': 0 } },
    });
  }
  process.stdout.write(
    `refresh-key: key ${key.id} (${String(key.scopes)} scopes) replaces ${old?.id ?? 'none'}\n`,
  );
}

async function revoke(runDir: string): Promise<boolean> {
  const file = path.join(runDir, 'credentials.json');
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) {
    process.stdout.write('revoke: no credentials to revoke\n');
    return true;
  }
  const credentials = JSON.parse(text) as Credentials;
  let info: StackInfo | undefined;
  try {
    info = await loadStack();
  } catch {
    info = undefined;
  }
  const results: Record<string, number | string> = {};
  const attempt = async (name: string, action: () => Promise<{ status: number }>) => {
    try {
      results[name] = (await action()).status;
    } catch (error) {
      results[name] = (error as Error).name;
    }
  };
  const api = credentials.apiUrl;
  const admin = info?.apiKey;
  if (credentials.flow !== undefined) {
    const flow = credentials.flow;
    await attempt('handoff-reject', () =>
      call(`${api}/api/v1/flow/handoffs/current/reject`, {
        method: 'POST',
        token: flow.sessionToken,
      }),
    );
    await attempt('sessions-expire', () =>
      call(`${api}/api/v1/inquiry-sessions/expire-all`, {
        method: 'POST',
        token: admin ?? credentials.apiKey?.token ?? '',
        body: { meta: { 'inquiry-id': flow.inquiryId } },
      }),
    );
  }
  if (credentials.apiKey !== undefined) {
    const key = credentials.apiKey;
    await attempt('key-expire', () =>
      call(`${api}/api/v1/api-keys/${key.id}/expire`, {
        method: 'POST',
        token: admin ?? key.token,
        body: { meta: { 'expires-in-seconds': 0 } },
      }),
    );
  }
  for (const [name, user] of Object.entries(credentials.users)) {
    if (user !== undefined) {
      await attempt(`user-${name}-sign-out`, () =>
        call(`${api}/api/v1/dashboard/sessions/current`, { method: 'DELETE', token: user.token }),
      );
    }
  }
  // Each credential is now refused (401), or the stack is gone with it.
  const refused: Record<string, boolean> = {};
  const probe = async (name: string, url: string, token: string) => {
    try {
      const answer = await call(url, { method: 'GET', token });
      refused[name] = answer.status === 401 || answer.status === 410;
      results[`${name}-probe`] = answer.status;
    } catch {
      refused[name] = info === undefined;
      results[`${name}-probe`] = 'unreachable';
    }
  };
  if (credentials.apiKey !== undefined) {
    await probe('key', `${api}/api/v1/inquiries?page[size]=1`, credentials.apiKey.token);
  }
  for (const [name, user] of Object.entries(credentials.users)) {
    if (user !== undefined) {
      await probe(`user-${name}`, `${api}/api/v1/dashboard/me`, user.token);
    }
  }
  if (credentials.flow !== undefined) {
    await probe('flow-session', `${api}/api/v1/flow/session`, credentials.flow.sessionToken);
  }
  await writePrivate(path.join(runDir, 'revoke.json'), { results, refused });
  const still = Object.entries(refused)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  process.stdout.write(
    `revoke: ${JSON.stringify(results)}${still.length > 0 ? `; still accepted: ${still.join(', ')}` : '; every credential is refused'}\n`,
  );
  return still.length === 0;
}

const [command, runDir] = process.argv.slice(2);
if (
  !['prepare', 'refresh-users', 'refresh-key', 'revoke'].includes(command ?? '') ||
  runDir === undefined ||
  !path.isAbsolute(runDir)
) {
  process.stderr.write(
    'usage: credentials.ts prepare|refresh-users|refresh-key|revoke <absolute run directory>\n',
  );
  process.exit(2);
}
try {
  if (command === 'prepare') {
    await prepare(runDir);
  } else if (command === 'refresh-users') {
    await refreshUsers(runDir);
  } else if (command === 'refresh-key') {
    await refreshKey(runDir);
  } else if (!(await revoke(runDir))) {
    process.exitCode = 1;
  }
} catch (error) {
  // The message names what failed and its status; no request or response is printed.
  process.stderr.write(`credentials.ts ${command}: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
