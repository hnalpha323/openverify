/**
 * K8-37 (Workflow 8D review): the one way an integration test starts its Testcontainers RustFS, the
 * pinned `rustfs/rustfs:1.0.3` (CLAUDE.md). In the Workflow 8C review's integration gate, one
 * RustFS container never answered `/health/ready` within Testcontainers' 60 s start at a load of
 * 9.9, and the same file alone passed. As K7B-13 did for Postgres (`startIntegrationPostgres`), a
 * start is done only once a signed S3 `ListBuckets` answers through the mapped port, polled with
 * backoff; a start that throws (Testcontainers stops and removes that container itself), or whose S3
 * API stays unready, is followed by a fresh container, at most {@link INTEGRATION_RUSTFS_RETRIES}
 * times, each retry said on stderr (`startWithRetries` of `@openverify/db/testing`). The start
 * timeout stays Testcontainers' 60 s. `integration-rustfs.test.ts` fails a RustFS image named
 * anywhere else.
 *
 * Testcontainers and the S3 client are loaded on the first start, so a unit test that imports this
 * module loads neither.
 */
import { startWithRetries } from '@openverify/db/testing';
import type { GenericContainer } from 'testcontainers';

/** The pinned RustFS image of every integration test (CLAUDE.md, `infra/docker-compose.yml`). */
export const RUSTFS_TEST_IMAGE =
  'rustfs/rustfs:1.0.3@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b';

/** Fresh containers after the first, as for Postgres: a start that fails three times is not load. */
export const INTEGRATION_RUSTFS_RETRIES = 2;

/** Testcontainers' wait for `/health/ready` on each start: its own 60 s default, never longer. */
export const INTEGRATION_RUSTFS_STARTUP_TIMEOUT_MS = 60_000;

/** How long a started container's S3 API may refuse `ListBuckets` before it is replaced. */
export const INTEGRATION_RUSTFS_READY_TIMEOUT_MS = 60_000;

/** The S3 port inside the container. */
export const RUSTFS_PORT = 9000;

const PROBE_TIMEOUT_MS = 5_000;

/** The synthetic keys a test's RustFS is started with and signs its requests by. */
export interface RustfsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StartedIntegrationRustfs {
  /** The S3 endpoint through the mapped port, `http://<host>:<port>`. */
  endpoint: string;
  /** The endpoint, as the retry loop reads it. */
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

/** The container one attempt starts: the pinned image, the keys, the port and the wait. */
export async function defineRustfsContainer(
  credentials: RustfsCredentials,
): Promise<GenericContainer> {
  const { GenericContainer, Wait } = await import('testcontainers');
  return new GenericContainer(RUSTFS_TEST_IMAGE)
    .withEnvironment({
      RUSTFS_ACCESS_KEY: credentials.accessKeyId,
      RUSTFS_SECRET_KEY: credentials.secretAccessKey,
      RUSTFS_ADDRESS: `:${String(RUSTFS_PORT)}`,
    })
    .withExposedPorts(RUSTFS_PORT)
    .withWaitStrategy(Wait.forHttp('/health/ready', RUSTFS_PORT).forStatusCode(200))
    .withStartupTimeout(INTEGRATION_RUSTFS_STARTUP_TIMEOUT_MS);
}

/** One signed `ListBuckets` on a new client, which is destroyed again; rejects when it cannot. */
export async function listBuckets(endpoint: string, credentials: RustfsCredentials): Promise<void> {
  const { ListBucketsCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    // A caller's object may carry more (a bucket name); the client takes the two keys alone.
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    maxAttempts: 1,
  });
  try {
    await client.send(new ListBucketsCommand({}), {
      abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } finally {
    client.destroy();
  }
}

export interface IntegrationRustfsOptions {
  /** stderr by default. */
  log?: ((line: string) => void) | undefined;
}

/**
 * A Testcontainers RustFS for an integration test, answering a signed `ListBuckets` through its
 * mapped port (K8-37).
 */
export async function startIntegrationRustfs(
  credentials: RustfsCredentials,
  options: IntegrationRustfsOptions = {},
): Promise<StartedIntegrationRustfs> {
  return startWithRetries<StartedIntegrationRustfs>({
    start: async () => {
      const container = await (await defineRustfsContainer(credentials)).start();
      const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(RUSTFS_PORT))}`;
      return { endpoint, getConnectionUri: () => endpoint, stop: () => container.stop() };
    },
    probe: (endpoint) => listBuckets(endpoint, credentials),
    retries: INTEGRATION_RUSTFS_RETRIES,
    readyTimeoutMs: INTEGRATION_RUSTFS_READY_TIMEOUT_MS,
    service: 'integration RustFS',
    probeName: 'ListBuckets',
    log: options.log,
  });
}
