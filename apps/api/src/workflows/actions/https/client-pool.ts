/**
 * C124.2: the HTTPS action keeps one client, and so one undici `Agent`, per (environment id,
 * network-policy hash), built lazily, and closes it when the environment's policy settings change. A
 * kept-alive socket is therefore never shared across environments or policies, and the policy stays
 * enforced inside the vetted lookup of the client that was built for it.
 */
import { createHash } from 'node:crypto';
import {
  HTTPS_ACTION_LIMITS,
  HTTPS_METHODS,
  WORKFLOW_HTTP_REFUSED_HEADERS,
} from '@openverify/workflow-engine/actions';
import type { OutboundHttp, OutboundHttpPolicyClient } from '../../../http/index.js';

/** What an environment's settings and the install's flags allow. */
export interface HttpsNetworkPolicy {
  ports: readonly number[];
  allowLoopback: boolean;
  allowCidrs: readonly string[];
  nat64Prefixes: readonly string[];
}

export interface HttpsClientPool {
  /** The environment's client under `policy`, which ends a client built under another. */
  clientFor(environmentId: string, policy: HttpsNetworkPolicy): OutboundHttpPolicyClient;
  close(): Promise<void>;
}

/** C124.5: what a 2xx may be. */
const CONTENT_TYPES = ['application/json', 'text/plain'] as const;
const EXPOSED_HEADERS = ['content-type', 'location', 'retry-after', 'etag'] as const;
const ceilingMs = HTTPS_ACTION_LIMITS['timeout-seconds-ceiling'].value * 1_000;

/** C124.4: what the action itself sets. A definition can never name them: its schema refuses that. */
const SET_BY_THE_ACTION: ReadonlySet<string> = new Set([
  'openverify-request-signature',
  'idempotency-key',
  'openverify-workflow-run',
]);
const REFUSED_HEADERS = WORKFLOW_HTTP_REFUSED_HEADERS.filter(
  (name) => !SET_BY_THE_ACTION.has(name),
);

/** Order means nothing in these lists, so two spellings of one policy are one client. */
function policyHash(policy: HttpsNetworkPolicy): string {
  const canonical = {
    ports: [...policy.ports].sort((left, right) => left - right),
    loopback: policy.allowLoopback,
    cidrs: [...policy.allowCidrs].sort(),
    nat64: [...policy.nat64Prefixes].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function createHttpsClientPool(
  outbound: OutboundHttp,
  options: { allowPlainHttp?: boolean } = {},
): HttpsClientPool {
  const clients = new Map<string, { hash: string; client: OutboundHttpPolicyClient }>();
  const build = (policy: HttpsNetworkPolicy): OutboundHttpPolicyClient => {
    if (outbound.policyClient === undefined) {
      throw new TypeError('https-action: this outbound factory makes no policy client');
    }
    return outbound.policyClient({
      name: 'https-action',
      contentTypes: CONTENT_TYPES,
      maxResponseBytes: HTTPS_ACTION_LIMITS['response-bytes'].value,
      timeoutMs: ceilingMs,
      methods: HTTPS_METHODS,
      portPolicy: { allowed: policy.ports },
      headerPolicy: { refused: REFUSED_HEADERS, refusedPrefixes: ['proxy-'] },
      refuseContentEncoding: true,
      allowPlainHttp: options.allowPlainHttp === true,
      networkPolicy: {
        allowLoopback: policy.allowLoopback,
        allowCidrs: policy.allowCidrs,
        nat64Prefixes: policy.nat64Prefixes,
      },
      exposeHeaders: EXPOSED_HEADERS,
    });
  };
  return {
    clientFor(environmentId, policy) {
      const hash = policyHash(policy);
      const held = clients.get(environmentId);
      // eslint-disable-next-line security/detect-possible-timing-attacks -- compares the cache key of an egress policy, not a secret
      if (held?.hash === hash) {
        return held.client;
      }
      // Closing waits for what is in flight, and a failed close leaves nothing to retry.
      void held?.client.close().catch(() => undefined);
      const client = build(policy);
      clients.set(environmentId, { hash, client });
      return client;
    },
    async close() {
      const held = [...clients.values()];
      clients.clear();
      await Promise.all(held.map(({ client }) => client.close()));
    },
  };
}
