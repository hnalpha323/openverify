/**
 * C126.4 (F09, H16; C55.10 and C55.11 amended): the sandbox message lists, one Valkey list per
 * environment and kind beside the untouched `otp` list, every body sealed under the keyring the
 * process installed, for the entry's own reference. A list names ids and HMACs, never an address,
 * and a record never claims more than it did: without its store the write fails, and nothing reads
 * as recorded. A search opens only what it can, so an unreadable entry never hides the rest.
 */
import { validateEmailDestination } from '@openverify/checks';
import {
  toTimestamp,
  type SandboxEmailSearchBody,
  type SandboxEmailSearchResponse,
  type SandboxMessageKind,
  type SandboxSlackSearchBody,
  type SandboxSlackSearchResponse,
  type SandboxWorkflowSmsSearchBody,
  type SandboxWorkflowSmsSearchResponse,
} from '@openverify/contracts';
import { openJson, otpDestinationIndex, sealJson, type Sealed } from '@openverify/db';
import { z } from 'zod';
import type { Clock, KeyValueCache } from '../../../ports.js';
import type { ApiDependencies } from '../../../services/context.js';

/** C126.4: provisional, ours. */
export const SANDBOX_MESSAGE_LIST = Object.freeze({ maxEntries: 500, ttlSeconds: 24 * 60 * 60 });

const LIST_PREFIX = 'openverify:sandbox-messages:';

/** The AAD context of a record's body, which is no column. */
const BODY_COLUMN = 'sandbox_messages.body';

/** The Valkey list of one environment and kind. It names ids only, never an address. */
export const sandboxMessageListKey = (environmentId: string, kind: SandboxMessageKind): string =>
  `${LIST_PREFIX}${environmentId}:${kind}`;

/** A record could not be written: nothing was sent, and nothing reads as recorded. */
export class SandboxSinkUnavailableError extends Error {
  override name = 'SandboxSinkUnavailableError';

  constructor() {
    super('sandbox_sink_unavailable');
  }
}

export interface SandboxMessageRecord {
  environmentId: string;
  /** `null` for a message no run sends, which no search can serve. */
  workflowRunId: string | null;
  stepId: string;
  messageRef: string;
  /** The recipient's HMAC under the environment's subkey, for email and SMS. */
  recipientIndex: string | null;
  /** The Slack secret's id, never its URL. */
  secretId: string | null;
  message: { subject?: string | undefined; text: string; html?: string | null | undefined };
}

const storedEntrySchema = z.object({
  'message-ref': z.string().min(1).max(256),
  'workflow-run-id': z.string().nullable(),
  'step-id': z.string(),
  'recorded-at': z.iso.datetime(),
  'recipient-index': z.string().nullable(),
  'secret-id': z.string().nullable(),
  body: z.string(),
});
type StoredEntry = z.infer<typeof storedEntrySchema>;

const bodySchema = z.object({
  subject: z.string().optional(),
  text: z.string(),
  html: z.string().nullable().optional(),
});

const rowOf = (environmentId: string, messageRef: string): string =>
  `${environmentId}:${messageRef}`;

/**
 * Keeps one message in its list, sealed.
 * @throws {SandboxSinkUnavailableError} without a store, or when it refuses the write.
 */
export async function recordSandboxMessage(
  deps: { cache: KeyValueCache | undefined; clock: Clock },
  kind: SandboxMessageKind,
  record: SandboxMessageRecord,
): Promise<void> {
  const { cache, clock } = deps;
  if (cache === undefined) {
    throw new SandboxSinkUnavailableError();
  }
  const { environmentId, messageRef } = record;
  const entry: StoredEntry = {
    'message-ref': messageRef,
    'workflow-run-id': record.workflowRunId,
    'step-id': record.stepId,
    'recorded-at': clock.now().toISOString(),
    'recipient-index': record.recipientIndex,
    'secret-id': record.secretId,
    body: sealJson(BODY_COLUMN, rowOf(environmentId, messageRef), record.message),
  };
  try {
    await cache.pushCapped(
      sandboxMessageListKey(environmentId, kind),
      JSON.stringify(entry),
      SANDBOX_MESSAGE_LIST.maxEntries,
      SANDBOX_MESSAGE_LIST.ttlSeconds,
    );
  } catch {
    throw new SandboxSinkUnavailableError();
  }
}

interface ReadEntry {
  entry: StoredEntry & { 'workflow-run-id': string };
  body: z.infer<typeof bodySchema>;
}

function readEntry(environmentId: string, stored: string): ReadEntry | null {
  try {
    const entry = storedEntrySchema.parse(JSON.parse(stored));
    const runId = entry['workflow-run-id'];
    if (runId === null) {
      return null;
    }
    const opened = openJson(
      BODY_COLUMN,
      rowOf(environmentId, entry['message-ref']),
      entry.body as Sealed,
    );
    return { entry: { ...entry, 'workflow-run-id': runId }, body: bodySchema.parse(opened) };
  } catch {
    return null;
  }
}

/** The list's entries that `matches` takes, newest first. */
async function readList(
  cache: KeyValueCache,
  environmentId: string,
  kind: SandboxMessageKind,
  matches: (entry: StoredEntry) => boolean,
): Promise<ReadEntry[]> {
  const stored = await cache.listRange(
    sandboxMessageListKey(environmentId, kind),
    SANDBOX_MESSAGE_LIST.maxEntries,
  );
  return stored.flatMap((raw) => {
    const read = readEntry(environmentId, raw);
    return read !== null && matches(read.entry) ? [read] : [];
  });
}

const originOf = ({ entry }: ReadEntry) => ({
  'message-ref': entry['message-ref'],
  'workflow-run-id': entry['workflow-run-id'],
  'step-id': entry['step-id'],
  'recorded-at': toTimestamp(new Date(entry['recorded-at'])),
});

/** Searched by the recipient's HMAC under the environment's subkey, as the SMS search is. */
export async function searchSandboxEmailMessages(
  deps: ApiDependencies,
  environmentId: string,
  body: SandboxEmailSearchBody,
): Promise<SandboxEmailSearchResponse> {
  const email = validateEmailDestination(body['email-address']);
  if (!email.ok) {
    return { data: [] };
  }
  const index = otpDestinationIndex(deps.blindIndexKey, {
    environmentId,
    channel: 'email',
    destination: email.normalized,
  });
  const found = await readList(
    deps.cache,
    environmentId,
    'email',
    (entry) => entry['recipient-index'] === index,
  );
  return {
    data: found.map((read) => ({
      ...originOf(read),
      'message-subject': read.body.subject ?? '',
      'message-text': read.body.text,
      'message-html': read.body.html ?? null,
    })),
  };
}

/** By secret id: a record names its secret, never the URL. */
export async function searchSandboxSlackMessages(
  deps: ApiDependencies,
  environmentId: string,
  body: SandboxSlackSearchBody,
): Promise<SandboxSlackSearchResponse> {
  const secretId = body['secret-id'];
  const found = await readList(
    deps.cache,
    environmentId,
    'slack',
    (entry) => entry['secret-id'] === secretId,
  );
  return {
    data: found.map((read) => ({
      ...originOf(read),
      'secret-id': secretId,
      'message-text': read.body.text,
    })),
  };
}

const SEPARATORS = /[\s().-]/gu;
const E164 = /^\+[1-9]\d{6,14}$/u;

export async function searchSandboxWorkflowSmsMessages(
  deps: ApiDependencies,
  environmentId: string,
  body: SandboxWorkflowSmsSearchBody,
): Promise<SandboxWorkflowSmsSearchResponse> {
  const e164 = body['phone-number'].replace(SEPARATORS, '');
  if (!E164.test(e164)) {
    return { data: [] };
  }
  const index = otpDestinationIndex(deps.blindIndexKey, {
    environmentId,
    channel: 'sms',
    destination: e164,
  });
  const found = await readList(
    deps.cache,
    environmentId,
    'workflow-sms',
    (entry) => entry['recipient-index'] === index,
  );
  return {
    data: found.map((read) => ({ ...originOf(read), 'message-text': read.body.text })),
  };
}
