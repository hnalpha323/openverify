/**
 * What only the infrastructure shows: where a file's ciphertext is stored (Postgres) and
 * whether any version of it is left in the object store (S3 API, RustFS). Used to prove that
 * redaction removes the stored files (C16).
 */
import {
  HeadObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import pg from 'pg';
import type { StackInfo } from '../../src/stack-info.js';

/** The S3 object key of each file, from the `files` table. */
export async function storageKeysOf(
  stack: StackInfo,
  fileIds: readonly string[],
): Promise<string[]> {
  const client = new pg.Client({ connectionString: stack.databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ id: string; storage_key: string }>(
      'select id, storage_key from files where id = any($1::text[])',
      [fileIds],
    );
    return fileIds.map((id) => {
      const row = result.rows.find((candidate) => candidate.id === id);
      if (row === undefined) {
        throw new Error(`No files row for ${id}`);
      }
      return row.storage_key;
    });
  } finally {
    await client.end();
  }
}

export interface ObjectStore {
  /** The HTTP status of `HeadObject` on the current version: 200, or 404 once it is gone. */
  headStatus(key: string): Promise<number>;
  /** Every version and delete marker stored under exactly `key`. */
  versions(key: string): Promise<string[]>;
  close(): void;
}

export function objectStore(stack: StackInfo): ObjectStore {
  const { s3 } = stack;
  const client = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
  return {
    async headStatus(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: key }));
        return 200;
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode !== undefined) {
          return error.$metadata.httpStatusCode;
        }
        throw error;
      }
    },
    async versions(key) {
      const listing = await client.send(
        new ListObjectVersionsCommand({ Bucket: s3.bucket, Prefix: key }),
      );
      return [...(listing.Versions ?? []), ...(listing.DeleteMarkers ?? [])]
        .filter((entry) => entry.Key === key)
        .map((entry) => entry.VersionId ?? '');
    },
    close() {
      client.destroy();
    },
  };
}
