/**
 * Test doubles for the ports (`../ports.ts`). Only tests import this folder.
 */
import { keyFrequencyBound } from '@openverify/core';
import type {
  ChangedList,
  WatchlistEntryRecord,
  WatchlistReads,
  WatchlistSourceState,
} from '@openverify/db';
import { newId, OTP_SMS_MAX_PER_HOUR, type AuditActor } from '@openverify/contracts';
import { resolveInquiryAccount } from '@openverify/db';
import { checkCount, checkKey } from '../cache/index.js';
import { PHASE6_DEFAULTS, type NfcSettings, type ReportLimits } from '../config.js';
import { DnsResolverError } from '../dns/index.js';
import { NotFoundError } from '../errors.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import { OutboundHttpError, type OutboundHttp, type OutboundHttpRequest } from '../http/index.js';
import { createSandboxSmsSender } from '../providers/sms/sandbox.js';
import {
  ulidIdGenerator,
  type AccountsService,
  type AuditEntry,
  type AuditLogger,
  type Clock,
  type DnsResolver,
  type IdGenerator,
  type KeyValueCache,
  type ListRescreenJob,
  type ListRescreenQueue,
  type MxRecord,
  type MailMessage,
  type Mailer,
  type ManagedNetworkSnapshots,
  type NetworkSnapshot,
  type ProcessVerificationJob,
  type ProviderBindings,
  type PublishEventInput,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitRule,
  type RedactionResult,
  type RedactionService,
  type ReportRescreenJob,
  type ReportRescreenQueue,
  type ReportRunJob,
  type ReportRunQueue,
  type GraphIndexJob,
  type GraphIndexQueue,
  type GraphQueryJob,
  type GraphQueryQueue,
  type WorkflowStepEnqueueOptions,
  type WorkflowStepJob,
  type WorkflowStepQueue,
  type WorkflowTriggerJob,
  type WorkflowTriggerQueue,
  type WorkflowWaitMatchJob,
  type WorkflowWaitMatchQueue,
  type InquirySignalsJob,
  type InquirySignalsQueue,
  type ResolveInquiryAccountInput,
  type ServiceContext,
  type VerificationQueue,
  type BiometricItemRedactor,
  type BiometricListMatcher,
  type BiometricListOutcome,
  type BiometricListsGate,
  type CompromisedIdAnswer,
  type CompromisedIdLookup,
  type ListItemToWrite,
  type ListItemWriteResult,
  type ListItemWriter,
  type ListService,
} from '../ports.js';

export const T0 = new Date('2026-10-20T12:00:00.000Z');

export interface TestClock extends Clock {
  /** Moves the clock forward by `ms` milliseconds. */
  advance(ms: number): void;
  set(date: Date): void;
}

/** A clock that only moves when told to. */
export function fixedClock(start: Date = T0): TestClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
    set: (date) => {
      current = date.getTime();
    },
  };
}

export interface RecordedEvent extends PublishEventInput {
  id: string;
}

export interface RecordingEventPublisher extends TransactionalEventPublisher {
  /** Events that were published, or staged and then dispatched, oldest first. */
  readonly events: RecordedEvent[];
  /** Makes the next `stage` or `publish` call reject with `error`. */
  failNext(error: Error): void;
  /** Events with this name, oldest first. */
  named(name: string): RecordedEvent[];
}

/**
 * Records events instead of writing them. A staged event counts once it is dispatched, which
 * callers do only after their transaction committed, so a rolled-back change records none.
 */
export function createRecordingEventPublisher(): RecordingEventPublisher {
  const events: RecordedEvent[] = [];
  const staged = new Map<string, RecordedEvent>();
  let failure: Error | undefined;
  const stage = (_tx: unknown, input: PublishEventInput): Promise<StagedEvent> => {
    if (failure !== undefined) {
      const error = failure;
      failure = undefined;
      return Promise.reject(error);
    }
    const id = newId('evt');
    staged.set(id, { ...structuredClone(input), id });
    return Promise.resolve({ eventId: id, deliveries: [] });
  };
  const dispatch = (dispatched: readonly StagedEvent[]): Promise<void> => {
    for (const { eventId } of dispatched) {
      const event = staged.get(eventId);
      if (event !== undefined) {
        staged.delete(eventId);
        events.push(event);
      }
    }
    return Promise.resolve();
  };
  return {
    events,
    failNext(error) {
      failure = error;
    },
    named: (name) => events.filter((event) => event.name === name),
    stage,
    dispatch,
    async publish(input) {
      const event = await stage(undefined, input);
      await dispatch([event]);
      return event.eventId;
    },
  };
}

export interface RecordingQueue extends VerificationQueue {
  readonly jobs: ProcessVerificationJob[];
  /** Makes the next enqueue reject with `error`. */
  failNext(error: Error): void;
}

/** Records every enqueued job instead of sending it to BullMQ. */
export function createRecordingQueue(): RecordingQueue {
  const jobs: ProcessVerificationJob[] = [];
  let failure: Error | undefined;
  return {
    jobs,
    failNext(error) {
      failure = error;
    },
    enqueueProcessVerification(job) {
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        return Promise.reject(error);
      }
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** Rejects once with the armed error, then behaves normally. */
function failOnce() {
  let failure: Error | undefined;
  return {
    arm: (error: Error): void => {
      failure = error;
    },
    take: (): Error | undefined => {
      const error = failure;
      failure = undefined;
      return error;
    },
  };
}

export interface RecordingAuditLogger extends AuditLogger {
  /** Every recorded entry, oldest first. */
  readonly entries: AuditEntry[];
  /** Makes the next `record` reject with `error`. */
  failNext(error: Error): void;
  /** Entries with this action, oldest first. */
  withAction(action: string): AuditEntry[];
}

/** Keeps audit entries in memory instead of writing them. */
export function createRecordingAuditLogger(): RecordingAuditLogger {
  const entries: AuditEntry[] = [];
  const failure = failOnce();
  return {
    entries,
    failNext: failure.arm,
    withAction: (action) => entries.filter((entry) => entry.action === action),
    record(_db, entry) {
      const error = failure.take();
      if (error !== undefined) {
        return Promise.reject(error);
      }
      entries.push(structuredClone(entry));
      return Promise.resolve();
    },
  };
}

export interface RecordingRateLimiter extends RateLimiter {
  /** Every `consume` call, oldest first. */
  readonly calls: { key: string; policy: RateLimitRule }[];
}

/**
 * Allows every request. `remaining` counts down per key and policy and stops at 0, and
 * `resetAt` is one window from the clock's time.
 */
export function createAllowAllRateLimiter(clock: Clock = fixedClock()): RecordingRateLimiter {
  const calls: RecordingRateLimiter['calls'] = [];
  const used = new Map<string, number>();
  return {
    calls,
    consume(key, policy) {
      calls.push({ key, policy: { ...policy } });
      const counter = `${policy.name}\u0000${key}`;
      const count = (used.get(counter) ?? 0) + 1;
      used.set(counter, count);
      const decision: RateLimitDecision = {
        allowed: true,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - count),
        resetAt: new Date(clock.now().getTime() + policy.windowSeconds * 1000),
        retryAfterSeconds: 0,
      };
      return Promise.resolve(decision);
    },
  };
}

/** Refuses every request, to be retried after `retryAfterSeconds`. */
export function createDenyRateLimiter(
  retryAfterSeconds = 30,
  clock: Clock = fixedClock(),
): RecordingRateLimiter {
  const calls: RecordingRateLimiter['calls'] = [];
  return {
    calls,
    consume(key, policy) {
      calls.push({ key, policy: { ...policy } });
      return Promise.resolve({
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetAt: new Date(clock.now().getTime() + retryAfterSeconds * 1000),
        retryAfterSeconds,
      });
    },
  };
}

export interface CapturingMailer extends Mailer {
  /** Every message sent, oldest first. */
  readonly messages: MailMessage[];
  /** Makes the next `send` reject with `error`. */
  failNext(error: Error): void;
}

/** Captures email instead of sending it. */
export function createCapturingMailer(): CapturingMailer {
  const messages: MailMessage[] = [];
  const failure = failOnce();
  return {
    configured: true,
    messages,
    failNext: failure.arm,
    send(message) {
      const error = failure.take();
      if (error !== undefined) {
        return Promise.reject(error);
      }
      messages.push({ ...message });
      return Promise.resolve();
    },
  };
}

export interface FakeAccountsService extends AccountsService {
  /** Every `resolveForInquiry` call, oldest first. */
  readonly calls: { ctx: ServiceContext; input: ResolveInquiryAccountInput }[];
}

/**
 * Resolves accounts without a database (C13 order): the given `accountId`; otherwise one id per
 * environment and reference id; otherwise a new id. It writes no account rows, so use the real
 * service where a foreign key needs the account to exist.
 */
export function createFakeAccountsService(ids: IdGenerator = ulidIdGenerator): FakeAccountsService {
  const calls: FakeAccountsService['calls'] = [];
  const byReference = new Map<string, string>();
  return {
    calls,
    resolveForInquiry(_tx, ctx, input) {
      calls.push({ ctx: { ...ctx }, input: { ...input } });
      if (input.accountId !== undefined) {
        return Promise.resolve(input.accountId);
      }
      if (input.referenceId === undefined) {
        return Promise.resolve(ids.newId('acc'));
      }
      const reference = `${ctx.environmentId}\u0000${input.referenceId}`;
      const accountId = byReference.get(reference) ?? ids.newId('acc');
      byReference.set(reference, accountId);
      return Promise.resolve(accountId);
    },
  };
}

/**
 * Resolves accounts on the account rows (C13 order, `resolveInquiryAccount`), recording every
 * call like {@link createFakeAccountsService}. The harness's default: every inquiry needs an
 * existing account row. It stages no `account.created` event, unlike the real service.
 * @throws {NotFoundError} (404) for an `accountId` outside the environment, as the real one.
 */
export function createRecordingDbAccountsService(): FakeAccountsService {
  const calls: FakeAccountsService['calls'] = [];
  return {
    calls,
    async resolveForInquiry(tx, ctx, input) {
      calls.push({ ctx: { ...ctx }, input: { ...input } });
      const accountId = await resolveInquiryAccount(tx, ctx.environmentId, input);
      if (accountId === null) {
        throw new NotFoundError(`Account ${String(input.accountId)} was not found.`);
      }
      return accountId;
    },
  };
}

export interface RecordedRedaction {
  target: 'inquiry' | 'account' | 'report' | 'transaction' | 'case';
  ctx: ServiceContext;
  id: string;
  actor: AuditActor | null;
}

export interface RecordingRedactionService extends RedactionService {
  /** Every call, oldest first, repeated ones included. */
  readonly redactions: RecordedRedaction[];
}

/**
 * Records redactions instead of removing anything. Like the real service it is idempotent: a
 * repeated call reports the first redaction time and `alreadyRedacted: true`.
 */
export function createRecordingRedactionService(
  clock: Clock = fixedClock(),
): RecordingRedactionService {
  const redactions: RecordedRedaction[] = [];
  const redactedAt = new Map<string, Date>();
  const redact = (
    target: RecordedRedaction['target'],
    ctx: ServiceContext,
    id: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult> => {
    redactions.push({ target, ctx: { ...ctx }, id, actor });
    const key = `${target}\u0000${ctx.environmentId}\u0000${id}`;
    const earlier = redactedAt.get(key);
    if (earlier !== undefined) {
      return Promise.resolve({ redactedAt: earlier, alreadyRedacted: true });
    }
    const now = clock.now();
    redactedAt.set(key, now);
    return Promise.resolve({ redactedAt: now, alreadyRedacted: false });
  };
  return {
    redactions,
    redactInquiry: (ctx, id, actor) => redact('inquiry', ctx, id, actor),
    redactAccount: (ctx, id, actor) => redact('account', ctx, id, actor),
    redactReport: (ctx, id, actor) => redact('report', ctx, id, actor),
    redactTransaction: (ctx, id, actor) => redact('transaction', ctx, id, actor),
    redactCase: (ctx, id, actor) => redact('case', ctx, id, actor),
  };
}

// Phase 5, Workflow 5A (C54.3) -------------------------------------------------------------------

export interface InMemoryKeyValueCache extends KeyValueCache {
  /** Every live key, for tests that scan what a path wrote (C61.2 scans for personal data). */
  keys(): string[];
  /** Makes the next call reject with `error`, as Valkey being down would. */
  failNext(error: Error): void;
}

/**
 * The key-value cache in memory, with TTLs on the given clock and the real cache's key and size
 * rules (`cache/index.ts`).
 */
export function createInMemoryKeyValueCache(clock: Clock = fixedClock()): InMemoryKeyValueCache {
  const values = new Map<string, { value: string | string[]; expiresAt: number }>();
  /** K8-8: each key's leases, by id, to when each lapses. */
  const leases = new Map<string, Map<string, number>>();
  const failure = failOnce();
  /** The live entry at `key`, after the real cache's checks and any armed failure. */
  const live = (key: string, counts: [number, string][] = []) => {
    checkKey(key);
    for (const [count, what] of counts) {
      checkCount(count, what);
    }
    const error = failure.take();
    if (error !== undefined) {
      throw error;
    }
    const entry = values.get(key);
    if (entry !== undefined && entry.expiresAt <= clock.now().getTime()) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };
  const expiry = (ttlSeconds: number) => clock.now().getTime() + ttlSeconds * 1000;
  const run = async <T>(call: () => T): Promise<T> => Promise.resolve().then(call);
  return {
    keys: () =>
      [...values.entries()]
        .filter(([, entry]) => entry.expiresAt > clock.now().getTime())
        .map(([key]) => key),
    failNext: failure.arm,
    get: (key) =>
      run(() => {
        const entry = live(key);
        return typeof entry?.value === 'string' ? entry.value : null;
      }),
    set: (key, value, ttlSeconds) =>
      run(() => {
        live(key, [[ttlSeconds, 'TTL']]);
        values.set(key, { value, expiresAt: expiry(ttlSeconds) });
      }),
    delete: (key) =>
      run(() => {
        live(key);
        values.delete(key);
      }),
    pushCapped: (key, value, maxLength, ttlSeconds) =>
      run(() => {
        const entry = live(key, [
          [maxLength, 'list length'],
          [ttlSeconds, 'TTL'],
        ]);
        const list = Array.isArray(entry?.value) ? entry.value : [];
        values.set(key, {
          value: [value, ...list].slice(0, maxLength),
          expiresAt: expiry(ttlSeconds),
        });
      }),
    listRange: (key, limit) =>
      run(() => {
        const entry = live(key, [[limit, 'range']]);
        return Array.isArray(entry?.value) ? entry.value.slice(0, limit) : [];
      }),
    acquireLease: (key, leaseId, limit, ttlSeconds) =>
      run(() => {
        live(key, [
          [limit, 'lease limit'],
          [ttlSeconds, 'TTL'],
        ]);
        const at = clock.now().getTime();
        const held = new Map(
          [...(leases.get(key) ?? new Map<string, number>())].filter(([, until]) => until > at),
        );
        if (held.size >= limit) {
          leases.set(key, held);
          return false;
        }
        held.set(leaseId, expiry(ttlSeconds));
        leases.set(key, held);
        return true;
      }),
    releaseLease: (key, leaseId) =>
      run(() => {
        live(key);
        leases.get(key)?.delete(leaseId);
      }),
  };
}

/** One host's answers for {@link createFakeDnsResolver}. */
export interface FakeDnsZone {
  mx?: readonly MxRecord[];
  a?: readonly string[];
  aaaa?: readonly string[];
  /** C85.2: each record as its character strings. */
  txt?: readonly (readonly string[])[];
}

export interface FakeDnsResolver extends DnsResolver {
  /** Every query, oldest first: its type and host. */
  readonly queries: { type: 'mx' | 'a' | 'aaaa' | 'txt'; hostname: string }[];
}

/**
 * Answers from `zones` only (no network, C54 rule 9): a host it lacks is `not_found`, a record type
 * a host lacks `no_data`, and a zone set to an error rejects with it.
 */
export function createFakeDnsResolver(
  zones: Readonly<Record<string, FakeDnsZone | DnsResolverError>> = {},
): FakeDnsResolver {
  const queries: FakeDnsResolver['queries'] = [];
  const answer =
    <T>(
      type: 'mx' | 'a' | 'aaaa' | 'txt',
      records: (zone: FakeDnsZone) => readonly T[] | undefined,
    ) =>
    (hostname: string): Promise<T[]> => {
      queries.push({ type, hostname });
      const zone = Object.hasOwn(zones, hostname) ? zones[hostname] : undefined;
      if (zone === undefined) {
        return Promise.reject(new DnsResolverError('not_found'));
      }
      if (zone instanceof DnsResolverError) {
        return Promise.reject(zone);
      }
      const found = records(zone);
      return found === undefined
        ? Promise.reject(new DnsResolverError('no_data'))
        : Promise.resolve([...found]);
    };
  return {
    queries,
    resolveMx: answer('mx', (zone) => zone.mx),
    resolve4: answer('a', (zone) => zone.a),
    resolve6: answer('aaaa', (zone) => zone.aaaa),
    resolveTxt: (hostname) =>
      answer(
        'txt',
        (zone) => zone.txt,
      )(hostname).then((records) => records.map((record) => [...record])),
  };
}

export interface RefusingOutboundHttp extends OutboundHttp {
  /** Every request a client was asked to make, oldest first: the client name, method and URL. */
  readonly requests: { client: string; request: OutboundHttpRequest }[];
}

/**
 * An outbound HTTP factory whose clients refuse every request (`blocked`), so a test never reaches
 * the network; tests of a real adapter build their own client over undici's MockAgent.
 */
export function createRefusingOutboundHttp(): RefusingOutboundHttp {
  const requests: RefusingOutboundHttp['requests'] = [];
  return {
    requests,
    client: (options) => ({
      request: (request) => {
        requests.push({ client: options.name, request });
        return Promise.reject(new OutboundHttpError(options.name, 'blocked'));
      },
    }),
    close: () => Promise.resolve(),
  };
}

/** The Workflow 5A members of `ApiDependencies` (C54.3), as {@link phase5TestDependencies} fills them. */
export interface Phase5TestDependencies {
  providers: ProviderBindings;
  blindIndexKey: Uint8Array;
  cache: InMemoryKeyValueCache;
  outboundHttp: RefusingOutboundHttp;
  otpSmsMaxPerHourCeiling: number;
  nfc: NfcSettings;
  reportLimits: ReportLimits;
  reportRuns: RecordingReportRunQueue;
}

/**
 * C54.3: the Workflow 5A members of `ApiDependencies` for a test: the sandbox SMS sender bound
 * for sandbox environments as `.env.example` binds it, its sink in this cache (Workflow 5C review
 * K9), and nothing else bound; a synthetic blind index key, the in-memory cache, an outbound
 * client that reaches nothing, the default OTP SMS ceiling. A test of an unbound channel binds
 * `{ sandbox: {}, production: {} }` itself.
 */
export function phase5TestDependencies(clock: Clock = fixedClock()): Phase5TestDependencies {
  const cache = createInMemoryKeyValueCache(clock);
  return {
    providers: { sandbox: { sms: createSandboxSmsSender({ cache, clock }) }, production: {} },
    blindIndexKey: new Uint8Array(32).fill(0x5b),
    cache,
    outboundHttp: createRefusingOutboundHttp(),
    otpSmsMaxPerHourCeiling: OTP_SMS_MAX_PER_HOUR.ceilingDefault,
    // C62.7: both trust-store settings at their defaults, off.
    nfc: { allowIcaoCrls: false, trustAnchorRefresh: false },
    // C72.5 (Phase 6): the report limits at the plan's defaults.
    reportLimits: {
      perMinute: PHASE6_DEFAULTS.reportsPerMinute,
      maxRecurringPerEnvironment: PHASE6_DEFAULTS.maxRecurringPerEnvironment,
      maxMediaRunsPerDay: PHASE6_DEFAULTS.maxMediaRunsPerDay,
    },
    reportRuns: createRecordingReportRunQueue(),
  };
}

/** C74.1 (Phase 6): a `report-run` producer that records each job, or rejects once when armed. */
export interface RecordingReportRunQueue extends ReportRunQueue {
  readonly jobs: ReportRunJob[];
  failNext(error: Error): void;
}

export function createRecordingReportRunQueue(): RecordingReportRunQueue {
  const jobs: ReportRunJob[] = [];
  let failure: Error | undefined;
  return {
    jobs,
    failNext(error) {
      failure = error;
    },
    enqueueReportRun(job) {
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        return Promise.reject(error);
      }
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C90.5 (Workflow 7A): an `inquiry-signals` producer that records each job. */
export interface RecordingInquirySignalsQueue extends InquirySignalsQueue {
  readonly jobs: InquirySignalsJob[];
}

export function createRecordingInquirySignalsQueue(): RecordingInquirySignalsQueue {
  const jobs: InquirySignalsJob[] = [];
  return {
    jobs,
    enqueueInquirySignals(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C101.3 (Workflow 7B): a `graph-index` producer that records each job. */
export interface RecordingGraphIndexQueue extends GraphIndexQueue {
  readonly jobs: GraphIndexJob[];
}

export function createRecordingGraphIndexQueue(): RecordingGraphIndexQueue {
  const jobs: GraphIndexJob[] = [];
  return {
    jobs,
    enqueueGraphIndex(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C102.4 (Workflow 7B): a `graph-query` producer that records each job. */
export interface RecordingGraphQueryQueue extends GraphQueryQueue {
  readonly jobs: GraphQueryJob[];
}

export function createRecordingGraphQueryQueue(): RecordingGraphQueryQueue {
  const jobs: GraphQueryJob[] = [];
  return {
    jobs,
    enqueueGraphQuery(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C117.9 (Workflow 8A): the step producers, recording each job and how it was enqueued. */
export interface RecordingWorkflowStepQueue extends WorkflowStepQueue {
  readonly jobs: { job: WorkflowStepJob; options: WorkflowStepEnqueueOptions }[];
}

export function createRecordingWorkflowStepQueue(): RecordingWorkflowStepQueue {
  const jobs: RecordingWorkflowStepQueue['jobs'] = [];
  return {
    jobs,
    enqueueWorkflowStep(job, options = {}) {
      jobs.push({ job: { ...job }, options });
      return Promise.resolve();
    },
  };
}

/** C118.1 (Workflow 8A): a `workflow-trigger` producer that records each job. */
export interface RecordingWorkflowTriggerQueue extends WorkflowTriggerQueue {
  readonly jobs: WorkflowTriggerJob[];
}

export function createRecordingWorkflowTriggerQueue(): RecordingWorkflowTriggerQueue {
  const jobs: WorkflowTriggerJob[] = [];
  return {
    jobs,
    enqueueWorkflowTrigger(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C119.3 (Workflow 8A): a `workflow-wait-match` producer that records each job. */
export interface RecordingWorkflowWaitMatchQueue extends WorkflowWaitMatchQueue {
  readonly jobs: WorkflowWaitMatchJob[];
}

export function createRecordingWorkflowWaitMatchQueue(): RecordingWorkflowWaitMatchQueue {
  const jobs: WorkflowWaitMatchJob[] = [];
  return {
    jobs,
    enqueueWorkflowWaitMatch(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C127.12: a `list-rescreen` producer that records each job. */
export interface RecordingListRescreenQueue extends ListRescreenQueue {
  readonly jobs: ListRescreenJob[];
}

export function createRecordingListRescreenQueue(): RecordingListRescreenQueue {
  const jobs: ListRescreenJob[] = [];
  return {
    jobs,
    enqueueListRescreen(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

/** C74.4 (Phase 6): a `report-rescreen` producer that records each job. */
export interface RecordingReportRescreenQueue extends ReportRescreenQueue {
  readonly jobs: ReportRescreenJob[];
}

export function createRecordingReportRescreenQueue(): RecordingReportRescreenQueue {
  const jobs: ReportRescreenJob[] = [];
  return {
    jobs,
    enqueueReportRescreen(job) {
      jobs.push({ ...job });
      return Promise.resolve();
    },
  };
}

// Phase 6, Workflow 6A Stage 1b (V11) ---------------------------------------------------------

/** One entry of the in-memory watchlists, with what retrieval reads. */
export interface FakeWatchlistEntry extends WatchlistEntryRecord {
  /** The C78.3 keys of the entry's names. */
  keys?: readonly string[];
  /** The sync that last added or changed it (`changed_sync_id`), for `changedInSync` loads. */
  changedSyncId?: number;
  identifiers?: readonly { kind: string; value: string; country?: string | null }[];
  cryptoAddresses?: readonly string[];
}

export interface InMemoryWatchlists extends WatchlistReads {
  entries: FakeWatchlistEntry[];
  sources: WatchlistSourceState[];
}

/**
 * The frozen watchlist reads (`WatchlistReads`) over in-memory entries and source states, for the
 * report framework's tests (V11). Retrieval matches the keys held by at most
 * `keyFrequencyBound(cap)` live entries of a source (owner decision 1 after 6B), exact identifiers
 * (and the country when both sides state one) and canonical crypto addresses, leaves out
 * `sandbox_only` sources for production, ranks by shared keys (then source and entry id, so ties
 * are stable), and reports `truncated` when the cap cuts the candidates or a reach group's keys are
 * all over the bound in a source.
 */
export function createInMemoryWatchlists(
  entries: readonly FakeWatchlistEntry[] = [],
  sources: readonly WatchlistSourceState[] = [],
): InMemoryWatchlists {
  const stored = [...entries];
  const states = [...sources];
  const screenable = (sourceId: string, kind: 'sandbox' | 'production') =>
    kind === 'sandbox' || states.find((state) => state.id === sourceId)?.sandboxOnly !== true;
  const sameIdentifier = (
    wanted: { kind: string; value: string; country?: string | null },
    held: { kind: string; value: string; country?: string | null },
  ) =>
    wanted.kind === held.kind &&
    wanted.value === held.value &&
    (wanted.country == null || held.country == null || wanted.country === held.country);
  return {
    entries: stored,
    sources: states,
    retrieveCandidates: (_db, query) => {
      const bound = keyFrequencyBound(query.cap);
      const live = stored.filter(
        (entry) =>
          query.sourceIds.includes(entry.sourceId) &&
          screenable(entry.sourceId, query.environmentKind) &&
          entry.removedAt === null,
      );
      const holders = (sourceId: string, key: string) =>
        live.filter((entry) => entry.sourceId === sourceId && (entry.keys ?? []).includes(key))
          .length;
      const usable = (sourceId: string, key: string) => holders(sourceId, key) <= bound;
      const sourceIds = [...new Set(live.map((entry) => entry.sourceId))];
      const unreachable = sourceIds.some((sourceId) =>
        (query.reach ?? []).some((group) => group.every((key) => !usable(sourceId, key))),
      );
      const found = live
        .map((entry) => {
          const sharedKeys = (entry.keys ?? []).filter(
            (key) => query.keys.includes(key) && usable(entry.sourceId, key),
          ).length;
          const via: ('keys' | 'identifier' | 'crypto')[] = [];
          if (sharedKeys > 0) via.push('keys');
          if (
            query.identifiers.some((wanted) =>
              (entry.identifiers ?? []).some((held) => sameIdentifier(wanted, held)),
            )
          ) {
            via.push('identifier');
          }
          if ((entry.cryptoAddresses ?? []).some((a) => query.cryptoAddresses.includes(a))) {
            via.push('crypto');
          }
          return { sourceId: entry.sourceId, entryId: entry.entryId, sharedKeys, via };
        })
        .filter((candidate) => candidate.via.length > 0)
        .sort(
          (a, b) =>
            b.sharedKeys - a.sharedKeys ||
            a.sourceId.localeCompare(b.sourceId) ||
            a.entryId.localeCompare(b.entryId),
        );
      const capReached = found.length > query.cap;
      return Promise.resolve({
        candidates: found.slice(0, query.cap),
        truncated: capReached || unreachable,
        capReached,
        unreachable,
      });
    },
    loadEntries: (_db, query) => {
      const changed = query.changedInSync;
      const page =
        changed === undefined
          ? []
          : stored
              .filter(
                (entry) =>
                  entry.changedSyncId === changed.syncId &&
                  entry.removedAt === null &&
                  screenable(entry.sourceId, query.environmentKind) &&
                  (changed.afterEntryId === undefined || entry.entryId > changed.afterEntryId),
              )
              .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0))
              .slice(0, changed.limit);
      const row = (entry: FakeWatchlistEntry) => ({
        sourceId: entry.sourceId,
        entryId: entry.entryId,
        kind: entry.kind,
        contentHash: entry.contentHash,
        riskDataHash: entry.riskDataHash,
        data: entry.data,
        removedAt: entry.removedAt,
      });
      // A page of changed entries alone comes in entry id order, as the database returns it.
      if (query.entries.length === 0) {
        return Promise.resolve(page.map(row));
      }
      return Promise.resolve(
        stored
          .filter(
            (entry) =>
              screenable(entry.sourceId, query.environmentKind) &&
              (page.includes(entry) ||
                query.entries.some(
                  (wanted) =>
                    wanted.sourceId === entry.sourceId && wanted.entryId === entry.entryId,
                )),
          )
          .map(row),
      );
    },
    // Owner decision 13 after 6B: a state without scripts gets its live entries' name scripts.
    getWatchlistSourceStates: (_db, sourceIds) =>
      Promise.resolve(
        states
          .filter((state) => sourceIds.includes(state.id))
          .map((state) => ({
            ...state,
            scripts:
              state.scripts ??
              [
                ...new Set(
                  stored
                    .filter((entry) => entry.sourceId === state.id && entry.removedAt === null)
                    .flatMap((entry) => {
                      const names = (entry.data as { names?: { script?: unknown }[] }).names ?? [];
                      return names.flatMap((name) =>
                        typeof name.script === 'string' ? [name.script] : [],
                      );
                    }),
                ),
              ].sort(),
          })),
      ),
  };
}

// Phase 7, Workflow 7A Stage 1b (N) -----------------------------------------------------------

/**
 * C92.3 (F41): network snapshots held in memory for tests: `current(kind)` leaves out the
 * `sandboxOnly` sources for production (H26), `swap` replaces one source's snapshot (a new
 * immutable view; the old one is released), and `close` releases every snapshot.
 */
export interface InMemoryNetworkSnapshots extends ManagedNetworkSnapshots {
  swap(snapshot: NetworkSnapshot): void;
  readonly started: boolean;
  readonly closed: boolean;
}

export function createInMemoryNetworkSnapshots(
  snapshots: readonly NetworkSnapshot[] = [],
): InMemoryNetworkSnapshots {
  let held: readonly NetworkSnapshot[] = Object.freeze([...snapshots]);
  let started = false;
  let closed = false;
  return {
    current: (kind) =>
      kind === 'production'
        ? Object.freeze(held.filter((snapshot) => !snapshot.sandboxOnly))
        : held,
    swap(snapshot) {
      const at = held.findIndex((current) => current.sourceId === snapshot.sourceId);
      held = Object.freeze(
        at === -1
          ? [...held, snapshot]
          : held.map((current, index) => (index === at ? snapshot : current)),
      );
    },
    start() {
      started = true;
      return Promise.resolve();
    },
    close() {
      closed = true;
      held = Object.freeze([]);
      return Promise.resolve();
    },
    get started() {
      return started;
    },
    get closed() {
      return closed;
    },
  };
}

// Workflow 7B (L) (C99.1, F08): in-memory fakes of the list ports, so a Stage 3 agent builds against
// another agent's port before it exists. Each records its calls.

export interface FakeListItemWriter extends ListItemWriter {
  /** Every item written, by list id, in order. */
  written: Map<string, ListItemToWrite[]>;
  /** The next answers' refusals: item indexes with a code. */
  refusals: ListItemWriteResult['refused'];
}

/** A fake `ListItemWriter`: a `value` already written to the list counts as `alreadyPresent`. */
export function createFakeListItemWriter(): FakeListItemWriter {
  const written = new Map<string, ListItemToWrite[]>();
  const fake: FakeListItemWriter = {
    written,
    refusals: [],
    insertItems(_tx, { listId, items }) {
      const held = written.get(listId) ?? [];
      const refused = new Set(fake.refusals.map(({ index }) => index));
      const seen = new Set(held.map((item) => JSON.stringify(item.attributes)));
      const inserted: { id: string }[] = [];
      let alreadyPresent = 0;
      items.forEach((item, index) => {
        const key = JSON.stringify(item.attributes);
        if (refused.has(index)) {
          return;
        }
        if (seen.has(key)) {
          alreadyPresent += 1;
          return;
        }
        seen.add(key);
        held.push(item);
        inserted.push({ id: newId('lis') });
      });
      written.set(listId, held);
      return Promise.resolve({ inserted, alreadyPresent, refused: fake.refusals });
    },
  };
  return fake;
}

export interface FakeListService extends ListService {
  created: { listId: string; item: ListItemToWrite }[];
}

/** A fake `ListService`: every item is new. */
export function createFakeListService(): FakeListService {
  const created: FakeListService['created'] = [];
  return {
    created,
    createItem({ listId, item }) {
      created.push({ listId, item });
      return Promise.resolve({ id: newId('lis'), alreadyPresent: false });
    },
    createItemInTx(_tx, { listId, item }) {
      created.push({ listId, item });
      return Promise.resolve({ id: newId('lis'), alreadyPresent: false });
    },
  };
}

export interface FakeBiometricListMatcher extends BiometricListMatcher {
  calls: { inquiryId: string; listIds: string[] }[];
  /** What `match` answers next. */
  outcome: BiometricListOutcome;
}

/** A fake `BiometricListMatcher`: answers `outcome`; by default, no match and nothing compared. */
export function createFakeBiometricListMatcher(): FakeBiometricListMatcher {
  const fake: FakeBiometricListMatcher = {
    calls: [],
    outcome: { matches: [], unscreened: [], compared: [] },
    match({ inquiryId, lists }) {
      fake.calls.push({ inquiryId, listIds: lists.map(({ id }) => id) });
      return Promise.resolve(fake.outcome);
    },
  };
  return fake;
}

export interface FakeBiometricItemRedactor extends BiometricItemRedactor {
  calls: { environmentId: string; inquiryId: string; at: Date }[];
  /** The envelope objects the next call answers. */
  storageKeys: string[];
  /** What the next call says it changed (C127.12, V25). */
  changedLists: ChangedList[];
  redactedItemIds: string[];
}

export function createFakeBiometricItemRedactor(): FakeBiometricItemRedactor {
  const fake: FakeBiometricItemRedactor = {
    calls: [],
    storageKeys: [],
    changedLists: [],
    redactedItemIds: [],
    redactBySource(_tx, input) {
      fake.calls.push({ ...input });
      return Promise.resolve({
        storageKeys: fake.storageKeys,
        changedLists: fake.changedLists,
        redactedItemIds: fake.redactedItemIds,
      });
    },
  };
  return fake;
}

export interface FakeBiometricListsGate extends BiometricListsGate {
  /** The environments with `biometric-lists-basis` set. */
  acknowledged: Set<string>;
}

export function createFakeBiometricListsGate(): FakeBiometricListsGate {
  const acknowledged = new Set<string>();
  return {
    acknowledged,
    isAcknowledged: (_db, environmentId) => Promise.resolve(acknowledged.has(environmentId)),
  };
}

export interface FakeCompromisedIdLookup extends CompromisedIdLookup {
  calls: { identificationNumber: string; idClass: string | null }[];
  /** What `lookup` answers next. */
  answer: CompromisedIdAnswer | null;
}

/** A fake `CompromisedIdLookup`: answers `answer`; by default `null`, no configured list. */
export function createFakeCompromisedIdLookup(): FakeCompromisedIdLookup {
  const fake: FakeCompromisedIdLookup = {
    calls: [],
    answer: null,
    lookup({ identificationNumber, idClass }) {
      fake.calls.push({ identificationNumber, idClass });
      return Promise.resolve(fake.answer);
    },
  };
  return fake;
}
