/**
 * C90.5, C90.8 (Workflow 7A; H23): the inquiry's `signals` and `signal-details` as the API, the
 * webhooks and the console serve them. Both are always present: `[]` and `{ computed-at: null }`
 * until the `inquiry-signals` job froze them, which tells "not yet" apart from "hidden". With the
 * environment's `expose-signals` off, the API and the webhooks serve `[]` and only `computed-at`;
 * the console (`exposeSignals: true` always) still shows them to users with `inquiries:read`.
 *
 * `inquiry/list_match_count` is never stored in `signals`: the `list-screen` job keeps it on the
 * inquiry's `list_screenings` row, and it is merged here, last in registry order, so the two jobs
 * never write one column (V06). It answers on its own while the stored signals are still `null`.
 *
 * Built by `foundation-7a` (Stage 1b (S)), `api-signals` owned it through 7A, `api-lists` in 7B.
 */
import type {
  SignalDetail,
  SignalDetails,
  SignalNullReason,
  SignalValue,
} from '@openverify/contracts';
import { getSignalDefinition } from '@openverify/core';
import type { Inquiry, ListScreening } from '@openverify/db';

const LIST_MATCH_COUNT = 'inquiry/list_match_count';

export interface ServedInquirySignals {
  signals: SignalValue[];
  signalDetails: SignalDetails;
}

/** What the environment says about showing signals (`expose-signals`, C90.8). */
export interface SignalView {
  exposeSignals: boolean;
}

/**
 * What one inquiry's two attributes are served from. `listScreening` is its `list_screenings` row,
 * `null` with no list selected, merged into `inquiry/list_match_count` (C90.5, C99.4, V06).
 */
export interface InquirySignalInput {
  inquiry: Pick<Inquiry, 'signals' | 'signalDetails'>;
  listScreening: ListScreening | null;
}

/** C99.4 (H02): the value and the null reason of the count: only a completed screening has one. */
function listCount(screening: ListScreening): {
  value: number | null;
  nullReason: SignalNullReason | null;
} {
  switch (screening.status) {
    case 'completed':
      return { value: screening.matchCount, nullReason: null };
    case 'pending':
      return { value: null, nullReason: 'list_screening_pending' };
    case 'partial':
    case 'errored':
      return { value: null, nullReason: 'list_unscreened' };
  }
}

const baseDetail = () => {
  const definition = getSignalDefinition(LIST_MATCH_COUNT);
  if (definition === undefined) {
    throw new Error(`${LIST_MATCH_COUNT} is not registered`);
  }
  const { tier, stage, version } = definition;
  return { tier, stage, version, reasons: [] };
};

/**
 * C99.4 (V06): the one signal written after completion, from its own row, at its own time. With no
 * row it reads `no_lists_selected` once the signals exist (`computedAt`); before that nothing is
 * known, and the inquiry keeps reading "not yet".
 */
function listCountEntry(
  screening: ListScreening | null,
  computedAt: string | null,
): { signal: SignalValue; detail: SignalDetail } | null {
  if (screening === null) {
    return computedAt === null
      ? null
      : {
          signal: { name: LIST_MATCH_COUNT, value: null },
          detail: {
            ...baseDetail(),
            'null-reason': 'no_lists_selected',
            'computed-at': computedAt,
          } as SignalDetail,
        };
  }
  const { value, nullReason } = listCount(screening);
  return {
    signal: { name: LIST_MATCH_COUNT, value },
    detail: {
      ...baseDetail(),
      'null-reason': nullReason,
      'computed-at': (screening.screenedAt ?? screening.createdAt).toISOString(),
      'list-screening': {
        status: screening.status,
        unscreened: screening.unscreened,
        'not-applicable': screening.notApplicable,
        'review-cause': screening.reviewCause,
      },
    } as SignalDetail,
  };
}

/** The two attributes for an inquiry, as `view` allows. */
export function servedInquirySignals(
  { inquiry, listScreening }: InquirySignalInput,
  view: SignalView,
): ServedInquirySignals {
  const stored = inquiry.signalDetails as SignalDetails | null;
  const computedAt = stored?.['computed-at'] ?? null;
  if (!view.exposeSignals) {
    return { signals: [], signalDetails: { 'computed-at': computedAt } };
  }
  const signals = inquiry.signals === null ? [] : (inquiry.signals as SignalValue[]);
  const details: SignalDetails = stored ?? { 'computed-at': null };
  const entry = listCountEntry(listScreening, inquiry.signals === null ? null : computedAt);
  return entry === null
    ? { signals, signalDetails: details }
    : {
        signals: [...signals, entry.signal],
        signalDetails: { ...details, [LIST_MATCH_COUNT]: entry.detail },
      };
}

/** The console's view: it shows the values to users with `inquiries:read` whatever the setting. */
export const CONSOLE_SIGNAL_VIEW: SignalView = Object.freeze({ exposeSignals: true });
