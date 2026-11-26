/**
 * C124, C125.3-C125.5: Make HTTPS Request. At least once: the engine runs it until `done`, so every
 * request carries its effect key, independent of the attempt (C124.6).
 *
 * The order is the point:
 *
 * 1. the config as written, and the literal host, against the environment's allowlist;
 * 2. the URL rendered for its sink, whose host must still be the literal one;
 * 3. the budgets, which fail closed;
 * 4. where each secret stands, and the secrets themselves, last (C125.5). The step's recorded input
 *    stays the unresolved template, and only the outgoing request ever holds a value;
 * 5. the audit entry of a marked step (C121.4), then the request, under a slot of the host;
 * 6. the answer, read through its declared schema and scrubbed of every value resolved here.
 *
 * Retries are the client's retryable failures, 429 and 5xx, while the step has one left; after that a
 * status is an answer, and the workflow reads it. Nothing here logs: a code goes to the step, and a
 * value to the sealed output.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  getEnvironment,
  resolveWorkflowSettings,
  type WorkflowSettings as EnvironmentWorkflowSettings,
} from '@openverify/db';
import { signWorkflowRequest } from '@openverify/node';
import {
  parseTemplate,
  renderTemplate,
  type JsonRecord,
  type JsonValue,
  type ParsedTemplate,
} from '@openverify/workflow-engine';
import {
  HTTPS_ACTION_LIMITS,
  httpsLiteralHost,
  makeHttpsRequestConfigSchema,
  type MakeHttpsRequestConfig,
} from '@openverify/workflow-engine/actions';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpPolicyResponse,
} from '../../../http/index.js';
import { CACHE_KEY_NAMESPACE } from '../../../cache/index.js';
import type { KeyValueCache } from '../../../ports.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type OutsideActionHandler,
} from '../../engine/action-port.js';
import { answering } from '../shared.js';
import { consumeBudget, workflowPolicyRule } from './budgets.js';
import { createHttpsClientPool, type HttpsClientPool } from './client-pool.js';
import { egressConfigOf } from './egress-config.js';
import { auditEgress } from './egress-audit.js';
import { hostIsListed, normalizeHost, normalizeHostOf } from './hosts.js';
import { errorBody, successBody } from './response.js';
import { createScrubber, type Scrubber } from './scrub.js';
import { openStepSecrets, type OpenedSecret, type SecretPlacement } from './secrets.js';

/** C124.3: the one port with no setting. */
const DEFAULT_PORT = 443;
/** C124.5: the most of an error body a step may keep. */
const ERROR_BODY_BYTES = HTTPS_ACTION_LIMITS['error-body-bytes'].value;
const BODY_BYTES = HTTPS_ACTION_LIMITS['body-bytes'].value;
/** C117.4: the action's limit plus a margin. */
const LEASE_MARGIN_SECONDS = 30;

/** Handed to a slot refused for now: the next second is as good a guess as any. */
const SLOT_RETRY_SECONDS = 1;

/** K8-8: a slot lasts the longest request a step may make, plus the margin, unless given back. */
const SLOT_TTL_SECONDS =
  HTTPS_ACTION_LIMITS['timeout-seconds-ceiling'].value + LEASE_MARGIN_SECONDS;

const refusedSlot = () =>
  new ActionStepError('rate_limited', {
    retryable: true,
    retryAfterSeconds: SLOT_RETRY_SECONDS,
  });

/**
 * C124.7: at most five requests to one host in one environment at once, across every worker of the
 * install: each request holds a lease in the shared store (`KeyValueCache.acquireLease`, K8-8), which
 * lapses on its own if the worker dies. Past five the step answers `rate_limited`, retryable, and so
 * it does when the store cannot answer: a slot not known to be free is not taken.
 */
export async function withHostSlot<Result>(
  cache: KeyValueCache,
  environmentId: string,
  host: string,
  work: () => Promise<Result>,
): Promise<Result> {
  const key = `${CACHE_KEY_NAMESPACE}workflow-https-slot:${createHash('sha256')
    .update(`${environmentId}\u0000${host}`)
    .digest('hex')}`;
  const leaseId = randomUUID();
  let taken: boolean;
  try {
    taken = await cache.acquireLease(
      key,
      leaseId,
      HTTPS_ACTION_LIMITS['host-concurrency'].value,
      SLOT_TTL_SECONDS,
    );
  } catch {
    taken = false;
  }
  if (!taken) {
    throw refusedSlot();
  }
  try {
    return await work();
  } finally {
    // A lease the store could not take back lapses with its TTL.
    await cache.releaseLease(key, leaseId).catch(() => undefined);
  }
}

const pools = new WeakMap<OutboundHttp, HttpsClientPool>();

/** One pool per outbound factory, closed with it. */
function poolOf(outbound: OutboundHttp): HttpsClientPool {
  const held = pools.get(outbound);
  if (held !== undefined) {
    return held;
  }
  const pool = createHttpsClientPool(outbound);
  pools.set(outbound, pool);
  return pool;
}

function configOf(context: ActionContext): MakeHttpsRequestConfig {
  const parsed = makeHttpsRequestConfigSchema.safeParse(context.config);
  if (!parsed.success) {
    throw new ActionStepError('action_input_invalid');
  }
  return parsed.data;
}

function templateOf(value: JsonValue, maxBytes?: number): ParsedTemplate {
  const parsed = parseTemplate(value, maxBytes === undefined ? {} : { maxBytes });
  if (!parsed.ok) {
    throw new ActionStepError('execution_error');
  }
  return parsed.template;
}

interface RenderedUrl {
  url: string;
  target: string;
  host: string;
}

function renderedUrl(context: ActionContext, config: MakeHttpsRequestConfig): RenderedUrl {
  const written = httpsLiteralHost(config.url);
  const literal = written === null ? null : normalizeHost(written);
  const rendered = renderTemplate(templateOf(config.url), { roots: context.scope.roots }, 'url');
  if (!rendered.ok) {
    throw new ActionStepError(rendered.code);
  }
  const url = typeof rendered.value === 'string' ? rendered.value : '';
  const parsed = URL.canParse(url) ? new URL(url) : null;
  // A template fills a path or a query alone, so this can only differ by a bug: it fails closed.
  if (parsed === null || literal === null || normalizeHostOf(parsed) !== literal) {
    throw new ActionStepError('destination_refused');
  }
  return { url, target: `${parsed.pathname}${parsed.search}`, host: literal };
}

function placementsOf(
  config: MakeHttpsRequestConfig,
  body: ParsedTemplate | null,
): readonly SecretPlacement[] {
  const headers = (config.headers ?? []).flatMap(({ name, value }) =>
    templateOf(value).references.flatMap(({ secret }) =>
      secret === null ? [] : [{ kind: 'header' as const, key: secret, name }],
    ),
  );
  const inBody = (body?.references ?? []).flatMap(({ secret, pointer }) =>
    secret === null ? [] : [{ kind: 'body' as const, key: secret, pointer }],
  );
  const signing =
    config.signing === undefined
      ? []
      : templateOf(config.signing.secret).references.flatMap(({ secret }) =>
          secret === null ? [] : [{ kind: 'signing' as const, key: secret }],
        );
  return [...headers, ...inBody, ...signing];
}

const secretsScope = (secrets: readonly OpenedSecret[]): Readonly<Record<string, string>> =>
  Object.fromEntries(secrets.map(({ key, value }) => [key, value]));

function renderHeaders(
  context: ActionContext,
  config: MakeHttpsRequestConfig,
  secrets: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const { name, value } of config.headers ?? []) {
    const rendered = renderTemplate(
      templateOf(value),
      { roots: context.scope.roots, secrets },
      'header',
    );
    if (!rendered.ok) {
      throw new ActionStepError(rendered.code);
    }
    if (typeof rendered.value !== 'string') {
      throw new ActionStepError('template_type_mismatch');
    }
    headers[name] = rendered.value;
  }
  return headers;
}

function renderBody(
  context: ActionContext,
  template: ParsedTemplate | null,
  secrets: Readonly<Record<string, string>>,
): string | undefined {
  if (template === null) {
    return undefined;
  }
  const rendered = renderTemplate(template, { roots: context.scope.roots, secrets }, 'json', {
    maxBytes: BODY_BYTES,
  });
  if (!rendered.ok) {
    throw new ActionStepError(rendered.code);
  }
  return JSON.stringify(rendered.value);
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  return Object.keys(headers).some((candidate) => candidate.toLowerCase() === name);
}

/** The signature of a request about to go out, one `w1` per active value (C124.6). */
function signatureHeader(
  context: ActionContext,
  config: MakeHttpsRequestConfig,
  secrets: readonly OpenedSecret[],
  request: { method: string; target: string; body: string | undefined },
): Record<string, string> {
  if (config.signing === undefined) {
    return {};
  }
  const [key] = templateOf(config.signing.secret).references.map(({ secret }) => secret);
  const signing = secrets.find((secret) => secret.key === key);
  if (signing === undefined) {
    throw new ActionStepError('secret_placement_refused');
  }
  const values = [
    signing.value,
    ...(signing.previousValue === null ? [] : [signing.previousValue]),
  ];
  return {
    'openverify-request-signature': signWorkflowRequest(
      {
        method: request.method,
        target: request.target,
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      values,
      Math.floor(context.services.clock.now().getTime() / 1_000),
    ),
  };
}

const REQUEST_FAILURES: ReadonlySet<string> = new Set([
  'dns',
  'timeout',
  'network',
  'connection_refused',
]);
const ANSWER_FAILURES: ReadonlySet<string> = new Set([
  'too_large',
  'content_type',
  'content_encoding',
]);

function stepErrorOf(error: OutboundHttpError): ActionStepError {
  if (REQUEST_FAILURES.has(error.code)) {
    return new ActionStepError('request_failed', { retryable: error.retryable });
  }
  return new ActionStepError(
    ANSWER_FAILURES.has(error.code) ? 'response_unsupported' : 'destination_refused',
  );
}

function retryAfterSeconds(header: string | undefined, now: Date): number | undefined {
  if (header === undefined) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now.getTime()) / 1_000));
}

/** C117.6: whether the engine has another attempt to give this step. */
function aRetryIsLeft(context: ActionContext): boolean {
  if (!context.entry.retry.allowed) {
    return false;
  }
  const { step, entry, attempt } = context;
  const own = step.type === 'action' ? step.retry?.['intervals-seconds'] : undefined;
  return (own ?? entry.retry.defaultIntervalsSeconds)[attempt - 1] !== undefined;
}

function outputOf(
  answer: OutboundHttpPolicyResponse,
  config: MakeHttpsRequestConfig,
  scrubber: Scrubber,
): JsonRecord {
  const success = answer.status >= 200 && answer.status <= 299;
  const body = success
    ? successBody(answer.body, answer.contentType, config['response-schema'])
    : errorBody(answer.body);
  return scrubber.json({
    status: answer.status,
    headers: { ...answer.headers },
    body,
  }) as JsonRecord;
}

interface EnvironmentFacts {
  settings: EnvironmentWorkflowSettings;
}

async function environmentFacts(context: ActionContext): Promise<EnvironmentFacts> {
  const environment = await getEnvironment(context.services.db, context.environmentId);
  if (environment === null) {
    throw new ActionStepError('execution_error');
  }
  return { settings: resolveWorkflowSettings(environment.settings) };
}

function clientOf(context: ActionContext, settings: EnvironmentWorkflowSettings) {
  const egress = egressConfigOf(context.services);
  return poolOf(context.services.outboundHttp).clientFor(context.environmentId, {
    ports: [DEFAULT_PORT, ...settings['workflow-http-ports']],
    allowLoopback: egress.httpAllowLoopback && context.environmentKind === 'sandbox',
    allowCidrs: settings['workflow-http-private-cidrs'],
    nat64Prefixes: egress.nat64Prefixes,
  });
}

async function execute(context: ActionContext): Promise<ActionResult> {
  const config = configOf(context);
  const { settings } = await environmentFacts(context);
  const { url, target, host } = renderedUrl(context, config);
  const hosts = settings['workflow-http-hosts'];
  if (hosts !== null && !hostIsListed(host, hosts)) {
    throw new ActionStepError('destination_refused');
  }
  const bodyTemplate = config.body === undefined ? null : templateOf(config.body, BODY_BYTES);
  const placements = placementsOf(config, bodyTemplate);
  await consumeBudget(
    context.services.rateLimiter,
    context.environmentId,
    workflowPolicyRule('workflow-http'),
  );
  const secrets = await openStepSecrets(context, host, placements);
  const scope = secretsScope(secrets);
  const scrubber = createScrubber(
    secrets.flatMap(({ value, previousValue }) =>
      previousValue === null ? [value] : [value, previousValue],
    ),
  );
  const headers = renderHeaders(context, config, scope);
  const body = renderBody(context, bodyTemplate, scope);
  const { method } = config;
  await auditEgress(context);
  const client = clientOf(context, settings);
  const answer = await withHostSlot(context.services.cache, context.environmentId, host, () =>
    client.request({
      method,
      url,
      headers: {
        ...headers,
        accept: 'application/json, text/plain',
        'accept-encoding': 'identity',
        ...(body !== undefined && !hasHeader(headers, 'content-type')
          ? { 'content-type': 'application/json' }
          : {}),
        ...signatureHeader(context, config, secrets, { method, target, body }),
        'idempotency-key': context.effectKey,
        'openverify-workflow-run': context.runId,
      },
      ...(body === undefined ? {} : { body }),
      timeoutMs: config['timeout-seconds'] * 1_000,
      ...(config['capture-error-body'] === true ? { captureErrorBodyBytes: ERROR_BODY_BYTES } : {}),
      signal: context.signal,
    }),
  );
  if ((answer.status === 429 || answer.status >= 500) && aRetryIsLeft(context)) {
    const after = retryAfterSeconds(answer.headers['retry-after'], context.services.clock.now());
    return {
      kind: 'failed',
      code: 'request_failed',
      retryable: true,
      ...(after === undefined ? {} : { retryAfterSeconds: after }),
    };
  }
  return { kind: 'succeeded', output: outputOf(answer, config, scrubber) };
}

async function guarded(context: ActionContext): Promise<ActionResult> {
  try {
    return await execute(context);
  } catch (error) {
    throw error instanceof OutboundHttpError ? stepErrorOf(error) : error;
  }
}

export const MAKE_HTTPS_REQUEST_HANDLER: OutsideActionHandler = {
  key: 'make_https_request',
  version: 1,
  shape: 'outside',
  leaseSeconds: (config) =>
    (typeof config['timeout-seconds'] === 'number'
      ? config['timeout-seconds']
      : HTTPS_ACTION_LIMITS['timeout-seconds'].value) + LEASE_MARGIN_SECONDS,
  execute: (context) => answering(() => guarded(context)),
};
