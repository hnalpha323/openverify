/**
 * S3-compatible storage for uploaded files (the `FileStorage` port). It only ever sees
 * ciphertext: the upload service encrypts each file with its own data key (`encryptBytes` from
 * `@openverify/db`, the file id as context) before `put`, and readers decrypt after `get`.
 * Object keys are `<environment id>/<256 random bits>` ({@link newStorageKey}), so they never
 * carry PII such as a client filename.
 *
 * `delete` removes every stored version of the key, not only the current one: in a bucket with
 * versioning on (the development bucket has it), a plain `DeleteObject` would keep the earlier
 * ciphertext as a noncurrent version, which C16 redaction must not leave behind. It needs the
 * `s3:ListBucketVersions` and `s3:DeleteObjectVersion` permissions; a store that does not
 * implement version listing (501) gets a plain delete.
 */
import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type ListObjectVersionsCommandOutput,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { isId } from '@openverify/contracts';
import type { FileStorage } from '../ports.js';

/** A `FileStorage` that holds resources (connections) until closed. */
export interface ClosableFileStorage extends FileStorage {
  close(): Promise<void>;
}

/** The part of `S3Client` the adapter uses; tests inject a fake. */
export interface S3Like {
  send(
    command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand | ListObjectVersionsCommand,
  ): Promise<unknown>;
  destroy(): void;
}

export interface S3FileStorageOptions {
  driver: 's3';
  bucket: string;
  region: string;
  /** For S3-compatible stores such as RustFS; omit for AWS. */
  endpoint?: string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  /** Address buckets as `<endpoint>/<bucket>`; most S3-compatible stores need it. */
  forcePathStyle?: boolean;
  /** Injected client; by default one is built from the options above. */
  client?: S3Like;
}

export interface MemoryFileStorageOptions {
  driver: 'memory';
}

export type FileStorageOptions = S3FileStorageOptions | MemoryFileStorageOptions;

export interface S3FileStorage extends ClosableFileStorage {
  readonly client: S3Like;
}

export interface InMemoryFileStorage extends ClosableFileStorage {
  /** Every stored key, for assertions in tests. */
  keys(): string[];
}

const MAX_KEY_LENGTH = 1024;
/** Segments of `[A-Za-z0-9_-]` separated by single `/` or `.`: no `..`, no empty segment. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const STORAGE_KEY = /^[A-Za-z0-9_-]+(?:[/.][A-Za-z0-9_-]+)*$/;
const KEY_RANDOM_BYTES = 32;

/**
 * Throws unless `key` is a safe object key.
 * @throws {TypeError} for an empty, oversized or path-like key.
 */
export function assertStorageKey(key: string): void {
  if (key.length > MAX_KEY_LENGTH || !STORAGE_KEY.test(key)) {
    throw new TypeError('Malformed storage key');
  }
}

/**
 * A new object key for a file of this environment: the environment id and 256 random bits.
 * @throws {TypeError} when `environmentId` is not an `env_` id.
 */
export function newStorageKey(environmentId: string): string {
  if (!isId('env', environmentId)) {
    throw new TypeError('Storage keys are scoped by an environment id');
  }
  return `${environmentId}/${randomBytes(KEY_RANDOM_BYTES).toString('base64url')}`;
}

/** Runs `work` now; a throw becomes a rejection, as it would from the S3 adapter. */
function settle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}

/** Ciphertext kept in a Map, for unit tests and local experiments. */
export function createInMemoryFileStorage(): InMemoryFileStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    put: (key, ciphertext) =>
      settle(() => {
        assertStorageKey(key);
        objects.set(key, ciphertext.slice());
      }),
    get: (key) =>
      settle(() => {
        assertStorageKey(key);
        return objects.get(key)?.slice() ?? null;
      }),
    delete: (key) =>
      settle(() => {
        assertStorageKey(key);
        objects.delete(key);
      }),
    keys: () => [...objects.keys()],
    close: () => Promise.resolve(),
  };
}

interface ByteBody {
  transformToByteArray: () => Promise<Uint8Array>;
}

function bodyOf(output: unknown): ByteBody | null {
  if (typeof output !== 'object' || output === null || !('Body' in output)) {
    return null;
  }
  const body = output.Body;
  return typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
    ? (body as ByteBody)
    : null;
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
    return true;
  }
  const metadata = '$metadata' in error ? error.$metadata : undefined;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === 404
  );
}

/** The store does not implement the operation (HTTP 501), as some S3-compatible stores answer. */
function isNotImplemented(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const metadata = '$metadata' in error ? error.$metadata : undefined;
  return (
    error.name === 'NotImplemented' ||
    (typeof metadata === 'object' &&
      metadata !== null &&
      'httpStatusCode' in metadata &&
      metadata.httpStatusCode === 501)
  );
}

/**
 * The version ids of every version and delete marker stored under exactly `key`, from every
 * page of the listing; `null` when the store cannot list versions. An entry without a version
 * id (a store that lists unversioned objects so) is `undefined`.
 */
async function versionIdsOf(
  client: S3Like,
  Bucket: string,
  key: string,
): Promise<(string | undefined)[] | null> {
  const ids: (string | undefined)[] = [];
  let markers: { KeyMarker?: string; VersionIdMarker?: string } = {};
  for (;;) {
    let page: Partial<ListObjectVersionsCommandOutput>;
    try {
      page = (await client.send(
        new ListObjectVersionsCommand({ Bucket, Prefix: key, ...markers }),
      )) as Partial<ListObjectVersionsCommandOutput>;
    } catch (error) {
      if (isNotImplemented(error)) {
        return null;
      }
      throw error;
    }
    for (const entry of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
      if (entry.Key === key) {
        ids.push(entry.VersionId);
      }
    }
    if (page.IsTruncated !== true) {
      return ids;
    }
    markers = {
      ...(page.NextKeyMarker === undefined ? {} : { KeyMarker: page.NextKeyMarker }),
      ...(page.NextVersionIdMarker === undefined
        ? {}
        : { VersionIdMarker: page.NextVersionIdMarker }),
    };
  }
}

function s3Client(options: S3FileStorageOptions): S3Client {
  const config: S3ClientConfig = {
    region: options.region,
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    // Objects are AES-GCM ciphertext, so integrity is checked on decryption. Optional flexible
    // checksums are off because several S3-compatible stores reject them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  if (options.endpoint !== undefined) {
    config.endpoint = options.endpoint;
  }
  return new S3Client(config);
}

function createS3FileStorage(options: S3FileStorageOptions): S3FileStorage {
  const client = options.client ?? s3Client(options);
  const Bucket = options.bucket;
  return {
    client,
    async put(key, ciphertext) {
      assertStorageKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: ciphertext,
          ContentType: 'application/octet-stream',
          ContentLength: ciphertext.byteLength,
        }),
      );
    },
    async get(key) {
      assertStorageKey(key);
      try {
        const body = bodyOf(await client.send(new GetObjectCommand({ Bucket, Key: key })));
        return body === null ? null : await body.transformToByteArray();
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    async delete(key) {
      assertStorageKey(key);
      const versionIds = await versionIdsOf(client, Bucket, key);
      // A store that cannot list versions, or lists the object without a version id, gets a
      // plain delete: the object is then unversioned, and must not stay (2B F010).
      if (versionIds === null || versionIds.includes(undefined)) {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      }
      // Deleting a version permanently removes it; no delete marker is created. A key without
      // versions gets no request, so nothing is left behind for it either.
      for (const VersionId of versionIds ?? []) {
        if (VersionId !== undefined) {
          await client.send(new DeleteObjectCommand({ Bucket, Key: key, VersionId }));
        }
      }
    },
    close() {
      client.destroy();
      return Promise.resolve();
    },
  };
}

/**
 * The `FileStorage` port: S3 (or an S3-compatible store such as RustFS) in services, a Map in
 * unit tests.
 */
export function createFileStorage(options: MemoryFileStorageOptions): InMemoryFileStorage;
export function createFileStorage(options: S3FileStorageOptions): S3FileStorage;
export function createFileStorage(options: FileStorageOptions): ClosableFileStorage;
export function createFileStorage(options: FileStorageOptions): ClosableFileStorage {
  return options.driver === 'memory' ? createInMemoryFileStorage() : createS3FileStorage(options);
}
