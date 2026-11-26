/**
 * The S3 file storage against RustFS (`startIntegrationRustfs`, Testcontainers): deleting a file
 * removes every stored version, as C16 redaction requires, on a versioned bucket (the bucket
 * `infra/docker-compose.yml` creates has versioning on) and on an unversioned one.
 */
import {
  CreateBucketCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startIntegrationRustfs,
  type StartedIntegrationRustfs,
} from '../test-support/integration-rustfs.js';
import { createFileStorage, newStorageKey, type S3FileStorage } from './index.js';

const S3 = {
  accessKeyId: 'synthetic-storage-key',
  secretAccessKey: 'synthetic-storage-secret',
};
const ENV = 'env_01M5CJXHG0000000000000000A';

let rustfs: StartedIntegrationRustfs;
let s3: S3Client;
let endpoint: string;

beforeAll(async () => {
  rustfs = await startIntegrationRustfs(S3);
  endpoint = rustfs.endpoint;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: S3,
  });
}, 180_000);

afterAll(async () => {
  s3.destroy();
  await rustfs.stop();
});

async function bucket(name: string, versioned: boolean): Promise<S3FileStorage> {
  await s3.send(new CreateBucketCommand({ Bucket: name }));
  if (versioned) {
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: name,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
  }
  return createFileStorage({
    driver: 's3',
    bucket: name,
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    ...S3,
  });
}

/** Every version and delete marker stored under `key`. */
async function storedVersions(name: string, key: string): Promise<string[]> {
  const listing = await s3.send(new ListObjectVersionsCommand({ Bucket: name, Prefix: key }));
  return [...(listing.Versions ?? []), ...(listing.DeleteMarkers ?? [])]
    .filter((entry) => entry.Key === key)
    .map((entry) => entry.VersionId ?? '');
}

describe('S3 file storage on RustFS', () => {
  it('deletes every version of a replaced object in a versioned bucket', async () => {
    const storage = await bucket('openverify-versioned', true);
    const key = newStorageKey(ENV);
    await storage.put(key, new Uint8Array([1, 2, 3]));
    await storage.put(key, new Uint8Array([4, 5, 6]));
    expect(await storedVersions('openverify-versioned', key)).toHaveLength(2);

    await storage.delete(key);

    expect(await storage.get(key)).toBeNull();
    expect(await storedVersions('openverify-versioned', key)).toEqual([]);
    await storage.close();
  });

  it('leaves no delete marker for a key that holds nothing', async () => {
    const storage = await bucket('openverify-versioned-empty', true);
    const key = newStorageKey(ENV);

    await storage.delete(key);

    expect(await storedVersions('openverify-versioned-empty', key)).toEqual([]);
    await storage.close();
  });

  it('deletes the object in an unversioned bucket', async () => {
    const storage = await bucket('openverify-unversioned', false);
    const key = newStorageKey(ENV);
    await storage.put(key, new Uint8Array([7]));

    await storage.delete(key);

    expect(await storage.get(key)).toBeNull();
    expect(await storedVersions('openverify-unversioned', key)).toEqual([]);
    await storage.close();
  });
});
