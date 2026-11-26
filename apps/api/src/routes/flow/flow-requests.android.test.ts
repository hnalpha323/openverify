/**
 * C224.4 (Workflow 10A, api-android-10a; review H02): every request body the Android SDK's real
 * `FlowApiClient` encodes is committed under `contracts/fixtures/flow-requests/android/` by its
 * client owner's MockEngine test (android-driver the screen submissions, the verification and the
 * signals; android-sdk-api the consent bodies; 10B and 10C their own), and this test parses each
 * with its route's zod request schema, so a body the SDK sends and the server's contract cannot
 * drift apart. It is data-driven over the directory through contracts-10a's table `index.json`
 * (file name to method, route and the `@openverify/contracts` export that parses it): a file the
 * table does not list, or lists with no such schema, fails, and so does a body its schema refuses.
 * A `.multipart.json` file (10B on) is parsed the same way, as the JSON its owner commits.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as contracts from '@openverify/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const DIRECTORY = path.resolve(
  import.meta.dirname,
  '../../../../../contracts/fixtures/flow-requests/android',
);

interface RequestFixtureEntry {
  readonly file: string;
  readonly method: string;
  readonly route: string;
  readonly schema: string;
  readonly workflow: string;
  readonly owner?: string;
}

interface RequestFixtureIndex {
  readonly entries: readonly RequestFixtureEntry[];
}

const EXPORTS = contracts as unknown as Readonly<Record<string, unknown>>;

/**
 * C224.4 (Workflow 10B): a `.multipart.json` request fixture, the shape
 * `contracts/fixtures/flow-requests/android/multipart.schema.json` states: the form fields as sent
 * (each a string; the route's fields schema parses them), and the file part's name (`file`), its
 * filename (`<kind>.<extension>`, never a person's own file name), its content type and its size in
 * bytes. Never the bytes themselves.
 */
const MULTIPART_FIXTURE_SCHEMA = z.strictObject({
  fields: z.record(z.string(), z.string()),
  file: z.strictObject({
    name: z.literal('file'),
    filename: z.string().max(64),
    'content-type': z.string().max(64),
    size: z.int().min(1),
  }),
});

/** The request fixtures of `directory`: every JSON file but the table and the schemas. */
function fixtureFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter(
      (file) =>
        file.endsWith('.json') && !file.startsWith('index.') && !file.endsWith('.schema.json'),
    )
    .sort();
}

/**
 * What is wrong with the fixtures of `directory` against `index`, one line per problem, naming the
 * file, the schema and each refused member's path and code, never a value.
 */
function requestFixtureProblems(
  directory: string,
  index: RequestFixtureIndex,
  exports: Readonly<Record<string, unknown>>,
): string[] {
  return fixtureFiles(directory).flatMap((file) => {
    const entry = index.entries.find((candidate) => candidate.file === file);
    if (entry === undefined) {
      return [`${file}: not listed in index.json`];
    }
    const schema = exports[entry.schema];
    if (!(schema instanceof z.ZodType)) {
      return [`${file}: ${entry.schema} is not a zod schema of @openverify/contracts`];
    }
    let body: unknown;
    try {
      body = JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
    } catch {
      return [`${file}: not JSON`];
    }
    if (file.endsWith('.multipart.json')) {
      const shape = MULTIPART_FIXTURE_SCHEMA.safeParse(body);
      if (!shape.success) {
        const issues = shape.error.issues.map(
          ({ path: at, code }) => `/${at.map(String).join('/')} ${code}`,
        );
        return [`${file}: the multipart shape refuses ${issues.join(', ')}`];
      }
      const kind = shape.data.fields.kind;
      if (
        kind === undefined ||
        !new RegExp(`^${kind}\\.[a-z0-9]+$`).test(shape.data.file.filename)
      ) {
        return [`${file}: the file part is not named after its kind`];
      }
      body = shape.data.fields;
    }
    const parsed = schema.safeParse(body);
    if (parsed.success) {
      return [];
    }
    const issues = parsed.error.issues.map(
      ({ path: at, code }) => `/${at.map(String).join('/')} ${code}`,
    );
    return [`${file}: ${entry.schema} refuses ${issues.join(', ')}`];
  });
}

const readIndex = (directory: string): RequestFixtureIndex =>
  JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8')) as RequestFixtureIndex;

describe('the Android request fixtures (C224.4)', () => {
  const index = readIndex(DIRECTORY);

  it('names a zod request schema of @openverify/contracts for every entry of the table', () => {
    expect(index.entries.length).toBeGreaterThan(0);
    expect(index.entries.filter(({ schema }) => !(EXPORTS[schema] instanceof z.ZodType))).toEqual(
      [],
    );
  });

  it('parses every committed fixture with its route schema', () => {
    expect(requestFixtureProblems(DIRECTORY, index, EXPORTS)).toEqual([]);
  });
});

describe('requestFixtureProblems', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'openverify-flow-requests-'));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** A scratch directory holding `files` (name to body) and a table of `entries`. */
  function directoryWith(
    name: string,
    files: Readonly<Record<string, unknown>>,
    entries: readonly RequestFixtureEntry[],
  ): string {
    const directory = path.join(scratch, name);
    mkdirSync(directory);
    for (const [file, body] of Object.entries({
      'index.json': { format: 1, description: 'scratch', entries },
      ...files,
    })) {
      writeFileSync(path.join(directory, file), JSON.stringify(body));
    }
    return directory;
  }

  const consentEntry = (file: string): RequestFixtureEntry => ({
    file,
    method: 'POST',
    route: '/api/v1/flow/consent',
    schema: 'flowConsentBodySchema',
    workflow: '10A',
  });
  const consentBody = { accepted: true, 'text-keys': ['consent.processing'], locale: 'en' };

  it('passes a body its schema accepts', () => {
    const directory = directoryWith('accepted', { 'consent-a.json': consentBody }, [
      consentEntry('consent-a.json'),
    ]);
    expect(requestFixtureProblems(directory, readIndex(directory), EXPORTS)).toEqual([]);
  });

  it('fails a file the table does not list, and an entry naming no schema', () => {
    const directory = directoryWith(
      'unlisted',
      { 'consent-a.json': consentBody, 'stray.json': consentBody },
      [{ ...consentEntry('consent-a.json'), schema: 'noSuchBodySchema' }],
    );
    expect(requestFixtureProblems(directory, readIndex(directory), EXPORTS)).toEqual([
      'consent-a.json: noSuchBodySchema is not a zod schema of @openverify/contracts',
      'stray.json: not listed in index.json',
    ]);
  });

  it('fails a body its schema refuses, naming the member and the code, never the value', () => {
    const directory = directoryWith(
      'refused',
      { 'consent-a.json': { ...consentBody, accepted: 'synthetic-yes', extra: 1 } },
      [consentEntry('consent-a.json')],
    );
    const problems = requestFixtureProblems(directory, readIndex(directory), EXPORTS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^consent-a\.json: flowConsentBodySchema refuses /);
    expect(problems[0]).toContain('/accepted invalid_value');
    expect(problems[0]).toContain('/ unrecognized_keys');
    expect(problems[0]).not.toContain('synthetic-yes');
  });

  // Workflow 10B (C224.4; 10A Stage 2 api-android-10a 9): a multipart request is committed as
  // `{fields, file}`: the form fields, parsed by the route's fields schema, and the file part's name,
  // filename, type and size, never its bytes.
  const uploadEntry = (file: string): RequestFixtureEntry => ({
    file,
    method: 'POST',
    route: '/api/v1/flow/verifications/:id/files',
    schema: 'flowFileUploadFieldsSchema',
    workflow: '10B',
  });
  const upload = {
    fields: { kind: 'front', 'capture-method': 'camera', 'capture-trigger': 'auto' },
    file: { name: 'file', filename: 'front.jpg', 'content-type': 'image/jpeg', size: 2048 },
  };

  it("parses a multipart fixture's fields with the route's schema and checks its file part", () => {
    const directory = directoryWith('multipart', { 'upload-a.multipart.json': upload }, [
      uploadEntry('upload-a.multipart.json'),
    ]);
    expect(requestFixtureProblems(directory, readIndex(directory), EXPORTS)).toEqual([]);
  });

  it('fails a multipart fixture with refused fields, a file part with bytes, or a file name that is not its kind', () => {
    const directory = directoryWith(
      'multipart-refused',
      {
        'upload-a.multipart.json': {
          ...upload,
          fields: { ...upload.fields, 'capture-trigger': 'timer' },
        },
        'upload-b.multipart.json': { ...upload, file: { ...upload.file, bytes: 'c3ludGhldGlj' } },
        'upload-c.multipart.json': {
          ...upload,
          file: { ...upload.file, filename: 'my-passport.jpg' },
        },
      },
      ['upload-a.multipart.json', 'upload-b.multipart.json', 'upload-c.multipart.json'].map(
        uploadEntry,
      ),
    );
    expect(requestFixtureProblems(directory, readIndex(directory), EXPORTS)).toEqual([
      'upload-a.multipart.json: flowFileUploadFieldsSchema refuses /capture-trigger invalid_value',
      'upload-b.multipart.json: the multipart shape refuses /file unrecognized_keys',
      'upload-c.multipart.json: the file part is not named after its kind',
    ]);
  });

  it('fails a file that is not JSON', () => {
    const directory = directoryWith('broken', {}, [consentEntry('consent-a.json')]);
    writeFileSync(path.join(directory, 'consent-a.json'), '{ not json');
    expect(requestFixtureProblems(directory, readIndex(directory), EXPORTS)).toEqual([
      'consent-a.json: not JSON',
    ]);
  });
});
