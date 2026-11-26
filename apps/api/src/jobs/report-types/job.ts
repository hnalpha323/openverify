/**
 * The frozen types of the report job hooks (Workflow 6A Stage 1b, `foundation-6`); see
 * `jobs/report-types/index.ts`.
 */
import type {
  ReportCoverageLimit,
  ReportErrorCode,
  ReportOrigin,
  ReportRunType,
  ReportType,
} from '@openverify/core';
import type {
  REPORT_NOTICES,
  REPORT_UNAVAILABLE_REASONS,
  ReportListProvenance,
} from '@openverify/contracts';

type ReportNotice = (typeof REPORT_NOTICES)[number];
type ReportUnavailableReason = (typeof REPORT_UNAVAILABLE_REASONS)[number];
import type { Db } from '@openverify/db';
import type { ReportLimits, WatchlistSettings } from '../../config.js';
import type { OutboundHttp } from '../../http/index.js';
import type {
  BoundProviders,
  Clock,
  DnsResolver,
  EnvironmentKind,
  KeyValueCache,
  NetworkSnapshots,
  RateLimiter,
} from '../../ports.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import type { WorkerLogger } from '../logger.js';

/** The report a run screens, as the framework read it under its claim. */
export interface ReportRunSubject {
  id: string;
  environmentId: string;
  environmentKind: EnvironmentKind;
  type: ReportType;
  origin: ReportOrigin;
  inquiryId: string | null;
  accountId: string | null;
  /** The decrypted query (C70.2); a report's query never changes (C75.4). */
  query: Readonly<Record<string, unknown>>;
  /** C84.2: each query field's source kind. */
  querySources: Readonly<Record<string, string>>;
  /** The pinned version's resolved configuration (`resolvedReportTemplateConfigSchema(type)`). */
  config: Readonly<Record<string, unknown>>;
  createdAt: Date;
}

/** The run, as claimed. */
export interface ReportRunInfo {
  id: string;
  runType: ReportRunType;
  /** The sync a `list_update` run screens (C74.4). */
  triggerSyncId: number | null;
  /** Claims made, this one included (C74.1). */
  attempt: number;
}

/** What a type hook may use; every network client is the worker's, never a new one. */
export interface ReportJobDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** C83: the providers bound per environment kind. */
  providers?: Readonly<Record<EnvironmentKind, BoundProviders>> | undefined;
  cache?: KeyValueCache | undefined;
  outboundHttp?: OutboundHttp | undefined;
  dnsResolver?: DnsResolver | undefined;
  rateLimiter?: RateLimiter | undefined;
  /** C73.2, C75.3: the blind-index key of the match indexes. */
  blindIndexKey?: Uint8Array | undefined;
  watchlists: WatchlistSettings;
  limits: ReportLimits;
  /** C92.3, C106.1 (Workflow 7A): the worker's network snapshots, for the `ip-address` report. */
  networkSnapshots?: NetworkSnapshots | undefined;
  /** The matcher data of a `custom-list` run; `loadMatcherData` unless a test gives its own. */
  matcherData?: (() => MatcherData) | undefined;
}

/** What a type's `run` receives. */
export interface ReportRunContext {
  report: ReportRunSubject;
  run: ReportRunInfo;
  deps: ReportJobDeps;
  /** The providers bound for the report's environment kind. */
  providers: BoundProviders;
  /** Aborts after 5 minutes (C74.1), so a live claim never expires under the run. */
  signal: AbortSignal;
}

/** C69.3: one reason the run could not answer in full; codes and source ids only. */
export interface ReportRunError {
  code: ReportErrorCode;
  /** The source it is about (`list_unavailable`, `list_stale`, `matcher_data_unavailable`). */
  source?: string;
}

/** C69.4: one source the run screened, with its provenance (the public `sources` entry). */
export interface ReportRunSource {
  sourceId: string;
  syncId: string;
  publishedAt: Date;
  checkedAt: Date;
  sha256: string;
  origin: 'publisher' | 'import';
  attribution: string;
}

/**
 * C73.2, C75.3: one entry (or article) a run found at or above the preset's minimum. The framework
 * keys it (`reportMatchEntryIndex`, `reportMatchEvidenceHash`), decides its transition
 * (`decideMatchTransition`) and seals `snapshot`.
 */
export interface FoundReportMatch {
  /** `null` for an article (the media types). */
  sourceId: string | null;
  /** The readable entry key: `<source id>:<publisher id>`, or the article key. */
  entryKey: string;
  /** C77.3: the entry's content hash at match time (an article's own hash for media). */
  contentHash: string;
  /** C77.3 (V06): the entry's risk-data hash; `null` for an article. */
  riskDataHash: string | null;
  /** The matched list name or article title, a part of the evidence (C75.3). */
  matchedName: string;
  score: number;
  /** The list values and components the review shows (C78.5), sealed by the framework. */
  snapshot: Readonly<Record<string, unknown>>;
}

/** What a completed run found and could compute, before the framework persists it. */
export interface ReportRunResult {
  /** Empty for a `ready` run; any error makes the run `errored` whatever it found (C69.4). */
  errors: readonly ReportRunError[];
  sources: readonly ReportRunSource[];
  /** C106.2: a custom-list run's list provenance, stored in place of `sources`. */
  listSources?: readonly ReportListProvenance[] | undefined;
  /** C78.5: the summary served as `coverage`; `null` for the types that do not match names. */
  coverage: { complete: boolean; limits: readonly ReportCoverageLimit[] } | null;
  /** Sealed in `reports.result`: the type's non-match attributes and the coverage detail. */
  result: Readonly<Record<string, unknown>>;
  /** C69.4: every field left `null`, and why. */
  unavailableFields: readonly { field: string; reason: ReportUnavailableReason }[];
  /** ADR 0002 §3d: the provider that answered. */
  provider: { id: string; sandbox: boolean } | null;
  /** ADR 0002 §3f: the preset and thresholds applied. */
  thresholds: Readonly<Record<string, string | number | boolean>> | null;
  notices: readonly ReportNotice[];
  matcherVersion: string | null;
  /** Types with review only; `[]` otherwise. */
  matches: readonly FoundReportMatch[];
  /** The canonical crypto address the framework indexes (crypto type only). */
  cryptoAddress?: string | undefined;
}

/**
 * C74.1: a run that completed, or one that must wait (a provider budget, C81.2): the framework
 * puts it back to `pending` with `not_before`, without counting the claim.
 */
export type RunOutcome =
  { kind: 'completed'; result: ReportRunResult } | { kind: 'wait'; notBefore: Date };

/** One report type's job hook. */
export interface ReportTypeJob {
  readonly type: ReportType;
  run(ctx: ReportRunContext): Promise<RunOutcome>;
}

/** A run of a type whose job is not built yet; the framework ends it `errored`. */
export class ReportTypeNotBuiltError extends Error {
  override name = 'ReportTypeNotBuiltError';
  readonly type: ReportType;

  constructor(type: ReportType) {
    super(`The ${type} report job is not built yet`);
    this.type = type;
  }
}

/** The job of a type whose owner has not landed yet: every run fails. */
export function unbuiltReportTypeJob(type: ReportType): ReportTypeJob {
  return { type, run: () => Promise.reject(new ReportTypeNotBuiltError(type)) };
}
