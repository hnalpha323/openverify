import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import {
  assertStorageKey,
  createFileStorage,
  createInMemoryFileStorage,
  newStorageKey,
  type S3Like,
} from './index.js';

const ENV = 'env_01M5CJXHG0000000000000000A';
const KEY = `${ENV}/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde`;
const S3_OPTIONS = {
  driver: 's3',
  bucket: 'openverify-files',
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  accessKeyId: 'synthetic-access-key',
  secretAccessKey: 'synthetic-secret-key',
  forcePathStyle: true,
} as const;

function fakeClient(respond: (command: unknown) => unknown = () => ({})) {
  // A throwing `respond` becomes a rejection, as with the real client.
  const send = vi.fn(
    (command: unknown) =>
      new Promise<unknown>((resolve) => {
        resolve(respond(command));
      }),
  );
  const destroy = vi.fn();
  const client: S3Like = { send, destroy };
  return { client, send, destroy };
}

describe('newStorageKey', () => {
  it('is the environment id plus 256 random bits, so it never carries PII', () => {
    const key = newStorageKey(ENV);

    expect(key).toMatch(/^env_01M5CJXHG0000000000000000A\/[A-Za-z0-9_-]{43}$/);
    expect(newStorageKey(ENV)).not.toBe(key);
  });

  it('refuses anything but an environment id as the prefix', () => {
    expect(() => newStorageKey('jane.doe@example.test')).toThrow(TypeError);
  });
});

describe('assertStorageKey', () => {
  it.each([
    '',
    '../escape',
    'a//b',
    '/leading',
    'trailing/',
    'spaces in key',
    'é',
    'x'.repeat(1025),
  ])('rejects %j', (key) => {
    expect(() => {
      assertStorageKey(key);
    }).toThrow(TypeError);
  });

  it('accepts generated keys', () => {
    expect(() => {
      assertStorageKey(newStorageKey(ENV));
    }).not.toThrow();
  });
});

describe('in-memory file storage', () => {
  it('stores, reads and deletes ciphertext', async () => {
    const storage = createInMemoryFileStorage();

    await storage.put(KEY, new Uint8Array([1, 2, 3]));
    expect(await storage.get(KEY)).toEqual(new Uint8Array([1, 2, 3]));
    expect(storage.keys()).toEqual([KEY]);

    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  it('returns null for a missing key and deletes a missing key quietly', async () => {
    const storage = createInMemoryFileStorage();

    expect(await storage.get(KEY)).toBeNull();
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });

  it('keeps its own copy, so callers cannot mutate stored bytes', async () => {
    const storage = createInMemoryFileStorage();
    const bytes = new Uint8Array([1, 2, 3]);

    await storage.put(KEY, bytes);
    bytes[0] = 9;
    const read = await storage.get(KEY);
    read?.fill(7);

    expect(await storage.get(KEY)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('replaces an existing object', async () => {
    const storage = createInMemoryFileStorage();

    await storage.put(KEY, new Uint8Array([1]));
    await storage.put(KEY, new Uint8Array([2]));

    expect(await storage.get(KEY)).toEqual(new Uint8Array([2]));
  });

  it('rejects malformed keys', async () => {
    const storage = createInMemoryFileStorage();

    await expect(storage.put('../x', new Uint8Array([1]))).rejects.toThrow(TypeError);
    await expect(storage.get('../x')).rejects.toThrow(TypeError);
    await expect(storage.delete('../x')).rejects.toThrow(TypeError);
  });

  it('is what createFileStorage returns for the memory driver', async () => {
    const storage = createFileStorage({ driver: 'memory' });

    await storage.put(KEY, new Uint8Array([4]));
    expect(await storage.get(KEY)).toEqual(new Uint8Array([4]));
    await expect(storage.close()).resolves.toBeUndefined();
  });
});

describe('S3 file storage', () => {
  it('puts the ciphertext as an opaque object in the bucket', async () => {
    const { client, send } = fakeClient();
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.put(KEY, new Uint8Array([1, 2, 3]));

    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: 'openverify-files',
      Key: KEY,
      Body: new Uint8Array([1, 2, 3]),
      ContentType: 'application/octet-stream',
      ContentLength: 3,
    });
  });

  it('gets the object bytes', async () => {
    const { client, send } = fakeClient(() => ({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([5, 6])) },
    }));
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    expect(await storage.get(KEY)).toEqual(new Uint8Array([5, 6]));
    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toEqual({ Bucket: 'openverify-files', Key: KEY });
  });

  it('reads a missing object (NoSuchKey) as null', async () => {
    const { client } = fakeClient(() => {
      throw new NoSuchKey({ message: 'The specified key does not exist.', $metadata: {} });
    });
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    expect(await storage.get(KEY)).toBeNull();
  });

  it('reads a bare 404 as null too', async () => {
    const { client } = fakeClient(() => {
      throw new S3ServiceException({
        name: 'NotFound',
        $fault: 'client',
        $metadata: { httpStatusCode: 404 },
      });
    });
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    expect(await storage.get(KEY)).toBeNull();
  });

  it('reads a response without a body as null', async () => {
    const { client } = fakeClient(() => ({}));
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    expect(await storage.get(KEY)).toBeNull();
  });

  it('propagates any other failure', async () => {
    const { client } = fakeClient(() => {
      throw new S3ServiceException({
        name: 'AccessDenied',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
      });
    });
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await expect(storage.get(KEY)).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  /** The inputs of every command of this class the fake client received, in order. */
  function inputsOf<T>(
    send: ReturnType<typeof fakeClient>['send'],
    type: abstract new (...args: never[]) => { input: T },
  ): T[] {
    return send.mock.calls
      .map(([command]) => command)
      .filter((command): command is { input: T } => command instanceof type)
      .map((command) => command.input);
  }

  it('deletes every version and delete marker of the object, so a versioned bucket keeps no copy (C16)', async () => {
    const { client, send } = fakeClient((command) =>
      command instanceof ListObjectVersionsCommand
        ? {
            IsTruncated: false,
            Versions: [
              { Key: KEY, VersionId: 'v2' },
              { Key: KEY, VersionId: 'v1' },
              // Another key sharing the prefix is never touched.
              { Key: `${KEY}-other`, VersionId: 'v9' },
            ],
            DeleteMarkers: [{ Key: KEY, VersionId: 'm1' }],
          }
        : {},
    );
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.delete(KEY);

    expect(inputsOf(send, ListObjectVersionsCommand)).toEqual([
      { Bucket: 'openverify-files', Prefix: KEY },
    ]);
    expect(inputsOf(send, DeleteObjectCommand)).toEqual([
      { Bucket: 'openverify-files', Key: KEY, VersionId: 'v2' },
      { Bucket: 'openverify-files', Key: KEY, VersionId: 'v1' },
      { Bucket: 'openverify-files', Key: KEY, VersionId: 'm1' },
    ]);
  });

  it('reads every page of the version listing before deleting', async () => {
    const { client, send } = fakeClient((command) => {
      if (!(command instanceof ListObjectVersionsCommand)) {
        return {};
      }
      return command.input.KeyMarker === undefined
        ? {
            IsTruncated: true,
            NextKeyMarker: KEY,
            NextVersionIdMarker: 'v2',
            Versions: [{ Key: KEY, VersionId: 'v3' }],
          }
        : { IsTruncated: false, Versions: [{ Key: KEY, VersionId: 'v1' }] };
    });
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.delete(KEY);

    expect(inputsOf(send, ListObjectVersionsCommand)).toEqual([
      { Bucket: 'openverify-files', Prefix: KEY },
      { Bucket: 'openverify-files', Prefix: KEY, KeyMarker: KEY, VersionIdMarker: 'v2' },
    ]);
    expect(inputsOf(send, DeleteObjectCommand).map((input) => input.VersionId)).toEqual([
      'v3',
      'v1',
    ]);
  });

  it('sends no delete for a key without versions, so it leaves no delete marker behind', async () => {
    const { client, send } = fakeClient(() => ({ IsTruncated: false }));
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.delete(KEY);

    expect(inputsOf(send, DeleteObjectCommand)).toEqual([]);
  });

  it('deletes the object plainly when the listing shows it without version ids, so no copy stays (2B F010)', async () => {
    const { client, send } = fakeClient((command) =>
      command instanceof ListObjectVersionsCommand
        ? { IsTruncated: false, Versions: [{ Key: KEY }, { Key: `${KEY}-other` }] }
        : {},
    );
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.delete(KEY);

    expect(inputsOf(send, DeleteObjectCommand)).toEqual([{ Bucket: 'openverify-files', Key: KEY }]);
  });

  it('falls back to a plain delete when the store does not implement version listing', async () => {
    const { client, send } = fakeClient((command) => {
      if (command instanceof ListObjectVersionsCommand) {
        throw new S3ServiceException({
          name: 'NotImplemented',
          $fault: 'server',
          $metadata: { httpStatusCode: 501 },
        });
      }
      return {};
    });
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.delete(KEY);

    expect(inputsOf(send, DeleteObjectCommand)).toEqual([{ Bucket: 'openverify-files', Key: KEY }]);
  });

  it('propagates any other failure of the version listing', async () => {
    const { client, send } = fakeClient(() => {
      throw new S3ServiceException({
        name: 'AccessDenied',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
      });
    });
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await expect(storage.delete(KEY)).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(inputsOf(send, DeleteObjectCommand)).toEqual([]);
  });

  it('validates keys before calling S3', async () => {
    const { client, send } = fakeClient();
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await expect(storage.put('a b', new Uint8Array([1]))).rejects.toThrow(TypeError);
    expect(send).not.toHaveBeenCalled();
  });

  it('destroys the client on close', async () => {
    const { client, destroy } = fakeClient();
    const storage = createFileStorage({ ...S3_OPTIONS, client });

    await storage.close();

    expect(destroy).toHaveBeenCalledOnce();
  });

  it('configures a real S3 client from the options when none is injected', async () => {
    const storage = createFileStorage(S3_OPTIONS);
    const client = storage.client as S3Client;

    expect(client).toBeInstanceOf(S3Client);
    expect(await client.config.region()).toBe('us-east-1');
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.credentials()).toMatchObject({
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: 'synthetic-secret-key',
    });
    const endpoint = await client.config.endpoint?.();
    expect(endpoint).toMatchObject({ hostname: '127.0.0.1', port: 9000, protocol: 'http:' });
    await storage.close();
  });

  it('uses the AWS endpoint when no endpoint is configured', async () => {
    const storage = createFileStorage({ ...S3_OPTIONS, endpoint: undefined });
    const client = storage.client as S3Client;

    expect(client.config.endpoint).toBeUndefined();
    await storage.close();
  });
});
