/**
 * C268.3 (Workflow 11D load-harness; Stage 1a amendment 10): what `seed:load` creates at each scale,
 * the method's spread table (`docs/calibration/load-phase11.md`, "The spread under the shipped
 * limits"). The reference scale is the method's; `small` divides every count by 100 (at least 2 of
 * each) and imports the 100,000-name watchlist table only. The labels name organisations and
 * environments as the method does (`load-a sandbox`, `load-s01 production`).
 */

export const LOAD_SCALES = ['small', 'reference'] as const;
export type LoadScale = (typeof LOAD_SCALES)[number];

export const LOAD_STEPS = [
  'organisations',
  'principals',
  'accounts',
  'inquiries',
  'lists',
  'transactions',
  'graph',
  'connect',
  'watchlists',
  'verify',
] as const;
export type LoadStep = (typeof LOAD_STEPS)[number];

/** The two main organisations and the sixteen spread ones: 18 organisations, 36 environments. */
export const MAIN_ORGANISATIONS = ['load-a', 'load-b'] as const;
export const SPREAD_ORGANISATIONS = Array.from(
  { length: 16 },
  (_, i) => `load-s${String(i + 1).padStart(2, '0')}`,
);
export const LOAD_ORGANISATIONS = [...MAIN_ORGANISATIONS, ...SPREAD_ORGANISATIONS];
export const ENVIRONMENT_KINDS = ['sandbox', 'production'] as const;

export const sandbox = (organisation: string) => `${organisation} sandbox`;
export const production = (organisation: string) => `${organisation} production`;
const spread = (from: number, to: number) => SPREAD_ORGANISATIONS.slice(from - 1, to);

/** Each scenario's key pool: its count at the reference scale and the environments, round-robin. */
export interface KeyPool {
  pool: string;
  count: number;
  environments: readonly string[];
}

export const KEY_POOLS: readonly KeyPool[] = Object.freeze([
  { pool: 'api-reads', count: 160, environments: [sandbox('load-a')] },
  { pool: 'api-writes', count: 80, environments: [sandbox('load-a')] },
  { pool: 'flow', count: 16, environments: [sandbox('load-a')] },
  { pool: 'webhook', count: 80, environments: [sandbox('load-b')] },
  { pool: 'screening', count: 8, environments: spread(1, 4).map(sandbox) },
  { pool: 'connect-source', count: 8, environments: [sandbox('load-a')] },
  { pool: 'connect-destination', count: 20, environments: [sandbox('load-b')] },
  { pool: 'export', count: 6, environments: spread(5, 10).map(sandbox) },
  { pool: 'fairness-flooder', count: 4, environments: [sandbox('load-s11')] },
  { pool: 'fairness-victim', count: 2, environments: [sandbox('load-s12')] },
  { pool: 'limiter', count: 1, environments: [sandbox('load-a')] },
  { pool: 'lists-import', count: 4, environments: spread(13, 16).map(sandbox) },
  { pool: 'lists-match', count: 40, environments: [sandbox('load-a')] },
  {
    pool: 'graph',
    count: 16,
    environments: spread(1, 8).flatMap((organisation) => [
      sandbox(organisation),
      production(organisation),
    ]),
  },
  { pool: 'transactions-write', count: 80, environments: [sandbox('load-b')] },
  { pool: 'transactions-search', count: 160, environments: [sandbox('load-b')] },
]);

/** The reference counts of the method (Stage 1a amendment 10 and "The reference machine"). */
export const REFERENCE_COUNTS = Object.freeze({
  /** Console users, half in each of load-a and load-b, each TOTP-enrolled. */
  users: 4000,
  accounts: 20_000,
  settledInquiries: 50_000,
  reviewInquiries: 60_000,
  writeInquiries: 10_000,
  flowInquiries: 40_000,
  verificationInquiries: 6000,
  /** Accounts to export, spread over load-s05...s10, each with `exportInquiries` inquiries. */
  exportAccounts: 60,
  exportInquiries: 20,
  /** Indexed accounts in each graph environment. */
  graphAccounts: 2000,
  connectSources: 100,
  listItems: Object.freeze({
    'email-address': 10_000,
    'phone-number': 10_000,
    name: 100_000,
    'ip-address': 10_000,
    country: 20,
  }),
  transactions: 200_000,
  screeningNames: 1000,
});

export type LoadCounts = {
  -readonly [K in keyof typeof REFERENCE_COUNTS]: K extends 'listItems'
    ? Record<keyof typeof REFERENCE_COUNTS.listItems, number>
    : number;
};

/** The reference count divided by 100 at the small scale, at least 2. */
export function scaled(count: number, scale: LoadScale): number {
  return scale === 'reference' ? count : Math.max(2, Math.floor(count / 100));
}

export function countsFor(scale: LoadScale): LoadCounts {
  const counts = {} as Record<string, unknown>;
  for (const [name, value] of Object.entries(REFERENCE_COUNTS)) {
    counts[name] =
      typeof value === 'number'
        ? scaled(value, scale)
        : Object.fromEntries(
            Object.entries(value).map(([kind, count]) => [kind, scaled(count, scale)]),
          );
  }
  return counts as LoadCounts;
}

/** The watchlist tables: 100,000 names (the sanctions profile) at both scales, 2,000,000 (the PEP
 * profile, in 8 parts) at the reference scale only. */
export const WATCHLIST_TABLES = Object.freeze({
  '100k': Object.freeze({ names: 100_000, parts: 1 }),
  '2m': Object.freeze({ names: 2_000_000, parts: 8 }),
});

/** Rows a part of a large step writes, so one call fits ten minutes (rule 8). */
export const PART_ROWS = 50_000;

/** The parts of a step of `rows` rows. */
export function partsOf(rows: number): number {
  return Math.max(1, Math.ceil(rows / PART_ROWS));
}
