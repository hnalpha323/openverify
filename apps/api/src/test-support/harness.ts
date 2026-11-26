/**
 * An API wired to a PGlite database, in-memory storage and recording ports, plus helpers to
 * seed data and call it. Only tests import this folder. Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import {
  API_SCOPES,
  defaultInquiryTemplateAttributes,
  newId,
  type CreateInquiryTemplateAttributes,
  type EnvironmentKind,
  type SupportedVerificationType,
} from '@openverify/contracts';
import type { ExtractedFields, ExtractionFieldSources, Permission } from '@openverify/core';
import {
  createApiKey,
  createFile,
  createGovernmentIdExtraction,
  createVerification,
  encryptBytes,
  generateApiKey,
  replaceVerificationChecks,
  revokeApiKey,
  setVerificationStatus,
  type CheckRequirement,
  type CheckStatus,
  type CheckType,
  type FileKind,
  type VerificationStatus,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { createDbApiKeyAuthenticator } from '../auth/api-key-lookup.js';
import { ulidIdGenerator } from '../ports.js';
import type { ApiDependencies } from '../services/context.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createInMemoryNetworkSnapshots,
  createRecordingAuditLogger,
  createRecordingDbAccountsService,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
  type CapturingMailer,
  type FakeAccountsService,
  type InMemoryKeyValueCache,
  type RefusingOutboundHttp,
  type RecordingAuditLogger,
  type RecordingEventPublisher,
  type RecordingQueue,
  type RecordingRateLimiter,
  type RecordingRedactionService,
  type TestClock,
} from './fakes.js';
import { createTestUserSessions, userPrincipal, type TestUserSessions } from './principals.js';

export const TEST_PEPPER = new TextEncoder().encode('synthetic-pepper-for-tests-0123456789abcdef');
export const FLOW_PUBLIC_URL = 'https://flow.example.test';
export const FLOW_ORIGIN = 'https://flow.example.test';
export const PROBLEM_JSON = 'application/problem+json; charset=utf-8';

/** The smallest valid images: their magic bytes plus padding. Never real photos. */
export const IMAGES = {
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]),
  webp: new Uint8Array([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]),
} as const;

export type TestApp = ReturnType<typeof buildApp>;

/** An organization with one environment and an API key holding every scope in it. */
export interface TestTenant {
  organizationId: string;
  environmentId: string;
  environmentKind: EnvironmentKind;
  token: string;
}

export interface TestApi extends TestTenant {
  app: TestApp;
  database: TestDatabase;
  /** The dependencies the app was built with, overrides included. */
  deps: ApiDependencies;
  events: RecordingEventPublisher;
  queue: RecordingQueue;
  storage: InMemoryFileStorage;
  clock: TestClock;
  /**
   * The default fakes of the Phase 2 ports. An override replaces the port in `deps` but not
   * here, so tests that override a port keep their own reference to it. `accounts` resolves
   * on the real account rows, because every inquiry needs one (C13).
   */
  accounts: FakeAccountsService;
  redaction: RecordingRedactionService;
  audit: RecordingAuditLogger;
  rateLimiter: RecordingRateLimiter;
  mailer: CapturingMailer;
  /** C54.3: the in-memory key-value cache (TTLs on the test clock). */
  cache: InMemoryKeyValueCache;
  /** C54.6: an outbound HTTP factory whose clients refuse every request. */
  outboundHttp: RefusingOutboundHttp;
  /** The user sessions `newUserToken` issues; injected as `resolveUserSession`. */
  userSessions: TestUserSessions;
  /** A fresh environment (own organization, sandbox by default) with an all-scopes key. */
  newTenant(options?: { kind?: EnvironmentKind }): Promise<TestTenant>;
  newApiKey(environmentId: string, options?: NewKeyOptions): Promise<string>;
  /**
   * An `ovu_` dashboard user session token for an environment created by this harness. By
   * default the user holds every permission and its session satisfied MFA.
   * @throws {Error} for an environment this harness did not create.
   */
  newUserToken(environmentId: string, options?: NewUserTokenOptions): string;
  close(): Promise<void>;
}

export interface NewUserTokenOptions {
  permissions?: Iterable<Permission>;
  mfaSatisfied?: boolean;
  userId?: string;
}

/** Dependencies to use instead of the defaults, or a function of the defaults that picks them. */
export type TestApiOverrides =
  Partial<ApiDependencies> | ((defaults: ApiDependencies) => Partial<ApiDependencies>);

export interface NewKeyOptions {
  scopes?: readonly string[];
  expiresAt?: Date;
  revoked?: boolean;
  /** C25.6: the key sees no PII. */
  piiMasked?: boolean;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Builds the API with every route on a fresh PGlite database, recording fakes for the ports
 * and in-memory user sessions, so the server API accepts both API keys and user tokens.
 */
export async function createTestApi(overrides: TestApiOverrides = {}): Promise<TestApi> {
  const database = await createTestDatabase();
  const clock = fixedClock();
  const events = createRecordingEventPublisher();
  const queue = createRecordingQueue();
  const storage = createInMemoryFileStorage();
  const accounts = createRecordingDbAccountsService();
  const redaction = createRecordingRedactionService(clock);
  const audit = createRecordingAuditLogger();
  const rateLimiter = createAllowAllRateLimiter(clock);
  const mailer = createCapturingMailer();
  const phase5 = phase5TestDependencies(clock);
  const { cache, outboundHttp } = phase5;
  const userSessions = createTestUserSessions();
  const defaults: ApiDependencies = {
    db: database.db,
    keyring: database.keyring,
    storage,
    events,
    queue,
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: FLOW_PUBLIC_URL,
    flowCorsOrigins: [FLOW_ORIGIN],
    accounts,
    redaction,
    audit,
    rateLimiter,
    mailer,
    // C54.3: no provider bound unless a test binds one; a synthetic blind index key.
    ...phase5,
    resolveUserSession: userSessions.resolve,
  };
  const merged: ApiDependencies = {
    ...defaults,
    ...(typeof overrides === 'function' ? overrides(defaults) : overrides),
  };
  // C93.2 (Workflow 7A): sessions are evaluated against empty in-memory snapshots and the test's
  // own providers, unless a test passes its own `network` (or `network: undefined`).
  const deps: ApiDependencies =
    'network' in merged
      ? merged
      : {
          ...merged,
          network: {
            snapshots: createInMemoryNetworkSnapshots(),
            providers: merged.providers,
            trustProxy: false,
            privatePeers: { observe: () => undefined },
            ids: merged.ids,
            logger: { warn: () => undefined },
          },
        };
  const authenticator = createDbApiKeyAuthenticator({
    db: database.db,
    pepper: TEST_PEPPER,
    clock,
  });
  const app = buildApp({
    lookupApiKey: authenticator.lookup,
    onAuthenticated: authenticator.touch,
    now: () => clock.now(),
    logger: false,
    mode: 'test',
    api: deps,
  });

  const tenants = new Map<string, { organizationId: string; environmentKind: EnvironmentKind }>();
  const newApiKey = async (environmentId: string, options: NewKeyOptions = {}) => {
    const kind = tenants.get(environmentId)?.environmentKind ?? 'sandbox';
    const generated = generateApiKey(kind, TEST_PEPPER);
    const key = await createApiKey(database.db, environmentId, {
      id: newId('key'),
      name: 'Test key',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: options.scopes ?? API_SCOPES,
      ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
      ...(options.piiMasked === undefined ? {} : { piiMasked: options.piiMasked }),
    });
    if (options.revoked === true) {
      await revokeApiKey(database.db, environmentId, key.id);
    }
    return generated.token;
  };
  const newTenant = async (options: { kind?: EnvironmentKind } = {}): Promise<TestTenant> => {
    const { organization, environment } = await createTestTenant(database.db, {
      kind: options.kind ?? 'sandbox',
    });
    tenants.set(environment.id, {
      organizationId: organization.id,
      environmentKind: environment.kind,
    });
    return {
      organizationId: organization.id,
      environmentId: environment.id,
      environmentKind: environment.kind,
      token: await newApiKey(environment.id),
    };
  };
  const newUserToken = (environmentId: string, options: NewUserTokenOptions = {}) => {
    const tenant = tenants.get(environmentId);
    if (tenant === undefined) {
      throw new Error(`unknown environment ${environmentId}: create it with newTenant()`);
    }
    return userSessions.issue(
      userPrincipal({
        organizationId: tenant.organizationId,
        environmentId,
        environmentKind: tenant.environmentKind,
        ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
        ...(options.mfaSatisfied === undefined ? {} : { mfaSatisfied: options.mfaSatisfied }),
        ...(options.userId === undefined ? {} : { userId: options.userId }),
      }),
    );
  };

  const tenant = await newTenant();
  return {
    app,
    database,
    deps,
    events,
    queue,
    storage,
    clock,
    accounts,
    redaction,
    audit,
    rateLimiter,
    mailer,
    cache,
    outboundHttp,
    userSessions,
    ...tenant,
    newTenant,
    newApiKey,
    newUserToken,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

interface Document<T = Record<string, unknown>> {
  data: T & { id: string; type: string; attributes: Record<string, unknown> };
  included?: { id: string; type: string; attributes: Record<string, unknown> }[];
  meta?: Record<string, string>;
  links?: { next: string | null };
}

/** Parses a JSON response, failing loudly with the body when the status is unexpected. */
export function expectStatus(response: LightMyRequestResponse, status: number): Document {
  if (response.statusCode !== status) {
    throw new Error(
      `expected HTTP ${String(status)}, got ${String(response.statusCode)}: ${response.body}`,
    );
  }
  return response.json<Document>();
}

/** `POST /api/v1/inquiry-templates` with the default template unless told otherwise. */
export async function createTemplate(
  api: TestApi,
  token = api.token,
  attributes: CreateInquiryTemplateAttributes = defaultInquiryTemplateAttributes(),
): Promise<string> {
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-templates',
    headers: bearer(token),
    payload: { data: { type: 'inquiry-template', attributes } },
  });
  return expectStatus(response, 201).data.id;
}

/** `POST /api/v1/inquiries`; creates a default template first when none is given. */
export async function createInquiry(
  api: TestApi,
  options: {
    token?: string;
    templateId?: string;
    referenceId?: string;
    fields?: Record<string, string | number | boolean | null>;
  } = {},
): Promise<string> {
  const token = options.token ?? api.token;
  const templateId = options.templateId ?? (await createTemplate(api, token));
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiries',
    headers: bearer(token),
    payload: {
      data: {
        type: 'inquiry',
        attributes: {
          'inquiry-template-id': templateId,
          ...(options.referenceId === undefined ? {} : { 'reference-id': options.referenceId }),
          ...(options.fields === undefined ? {} : { fields: options.fields }),
        },
      },
    },
  });
  return expectStatus(response, 201).data.id;
}

/** `POST /api/v1/inquiries/:id/resume`: the session token for the flow API. */
export async function resumeInquiry(
  api: TestApi,
  inquiryId: string,
  token = api.token,
): Promise<string> {
  const response = await api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${inquiryId}/resume`,
    headers: bearer(token),
  });
  const sessionToken = expectStatus(response, 200).meta?.['session-token'];
  if (sessionToken === undefined) {
    throw new Error('resume returned no session token');
  }
  return sessionToken;
}

export interface SeedCheck {
  name: string;
  status: CheckStatus;
  type?: CheckType;
  requirement?: CheckRequirement;
  reasons?: string[];
  metadata?: Record<string, unknown>;
}

/** Inserts a verification (and optionally files and checks) directly, as the worker would. */
export async function seedVerification(
  api: TestApi,
  environmentId: string,
  inquiryId: string,
  options: {
    type?: SupportedVerificationType;
    status?: VerificationStatus;
    checks?: SeedCheck[];
    files?: FileKind[];
    /** A government ID's C31 extraction, as the worker stores it (synthetic values only). */
    extraction?: { fields: ExtractedFields; sources: ExtractionFieldSources };
  } = {},
): Promise<{ id: string; fileIds: string[] }> {
  const { db } = api.database;
  const verification = await createVerification(db, environmentId, {
    id: newId('ver'),
    inquiryId,
    type: options.type ?? 'government_id',
  });
  const fileIds: string[] = [];
  for (const kind of options.files ?? []) {
    const id = newId('file');
    const plaintext = IMAGES.jpeg;
    const sealed = encryptBytes(plaintext, api.database.keyring, { context: id });
    const storageKey = `${environmentId}/${id}`;
    await api.storage.put(storageKey, sealed.ciphertext);
    await createFile(db, environmentId, {
      id,
      verificationId: verification.id,
      kind,
      storageKey,
      mimeType: 'image/jpeg',
      byteSize: plaintext.byteLength,
      sha256: createHash('sha256').update(plaintext).digest('hex'),
      wrappedDek: sealed.wrappedDek,
    });
    fileIds.push(id);
  }
  if (options.checks !== undefined) {
    await replaceVerificationChecks(
      db,
      environmentId,
      verification.id,
      options.checks.map((check) => ({
        name: check.name,
        status: check.status,
        type: check.type ?? 'user_behavior',
        requirement: check.requirement ?? 'required',
        reasons: check.reasons ?? [],
        metadata: check.metadata ?? {},
      })),
    );
  }
  if (options.extraction !== undefined) {
    await createGovernmentIdExtraction(db, environmentId, {
      verificationId: verification.id,
      fields: options.extraction.fields,
      fieldSources: options.extraction.sources,
      identificationNumberIndex: null,
      frontPhash: null,
    });
  }
  if (options.status !== undefined && options.status !== 'initiated') {
    await setVerificationStatus(db, environmentId, verification.id, { to: options.status });
  }
  return { id: verification.id, fileIds };
}

/** A created inquiry and a session token for it, as the hosted flow receives them. */
export async function openFlowSession(
  api: TestApi,
  options: { token?: string; templateId?: string } = {},
): Promise<{ inquiryId: string; sessionToken: string }> {
  const inquiryId = await createInquiry(api, options);
  return { inquiryId, sessionToken: await resumeInquiry(api, inquiryId, options.token) };
}

export interface MultipartFile {
  bytes: Uint8Array;
  filename?: string;
  type?: string;
}

/** A multipart/form-data body, encoded by the platform's FormData as a browser would. */
export async function multipart(
  fields: Readonly<Record<string, string | MultipartFile>>,
): Promise<{ payload: Buffer; headers: { 'content-type': string } }> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      form.append(name, value);
    } else {
      const blob = new Blob([value.bytes], { type: value.type ?? 'application/octet-stream' });
      form.append(name, blob, value.filename ?? 'upload.bin');
    }
  }
  const request = new Request('http://localhost/', { method: 'POST', body: form });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  };
}
