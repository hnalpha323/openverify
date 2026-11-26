/**
 * `pnpm --filter @openverify/api api-keys:pepper-status [--json]` (C247.1; Phase 11, Workflow 11B,
 * auth-sessions): how many API keys each pepper holds, so an operator who rotated
 * `OPENVERIFY_API_KEY_PEPPER` (moving the old value to `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`) knows
 * when an earlier pepper can go: when its count is 0, or when the keys it still holds may stop
 * working. A key found under an earlier pepper is re-hashed under the current one when it is next
 * used, so the counts fall as keys are used.
 *
 * The counts are read from `api_keys.pepper_key_id` (Stage 1a amendment 9): a key made before 11B
 * has none until a lookup proves its pepper ("not yet proved"), and a pepper id that matches no
 * configured pepper is a pepper already removed. Peppers are named by their non-secret ids only;
 * the command never prints a key, a token or a hash. It runs as the runtime role (amendment 15).
 */
import { apiKeyPepperId, countApiKeysByPepper, type Db } from '@openverify/db';

export const PEPPER_STATUS_USAGE =
  'Usage: pnpm --filter @openverify/api api-keys:pepper-status [--json]\n';

export interface PepperStatusInput {
  readonly db: Db;
  /** `OPENVERIFY_API_KEY_PEPPER`. */
  readonly current: Uint8Array;
  /** `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`. */
  readonly previous: readonly Uint8Array[];
  readonly argv: readonly string[];
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

interface PepperCount {
  readonly 'pepper-id': string;
  readonly keys: number;
}

/** What the command reports (`--json` prints it as is). */
export interface PepperStatus {
  readonly current: PepperCount;
  readonly earlier: readonly PepperCount[];
  readonly 'not-proved': number;
  readonly 'not-configured': readonly PepperCount[];
}

const keys = (count: number): string => `${String(count)} ${count === 1 ? 'key' : 'keys'}`;

function words(status: PepperStatus): string {
  return [
    'API key pepper status (peppers are named by their ids; no key or hash is shown)',
    `Current pepper (id ${status.current['pepper-id']}): ${keys(status.current.keys)}`,
    ...status.earlier.map(
      (pepper, index) =>
        `Earlier pepper ${String(index + 1)} (id ${pepper['pepper-id']}): ${keys(pepper.keys)}`,
    ),
    `Not yet proved (made before pepper ids were kept, not used since): ${keys(status['not-proved'])}`,
    ...status['not-configured'].map(
      (pepper) =>
        `Under a pepper no longer configured (id ${pepper['pepper-id']}): ${keys(pepper.keys)}`,
    ),
    'Remove an earlier pepper from OPENVERIFY_API_KEY_PEPPER_PREVIOUS only when its count is 0, ' +
      'or when the keys it still holds, and those not yet proved, may stop working.',
    '',
  ].join('\n');
}

/**
 * The counts per configured pepper, in the order configured.
 * @returns the exit code: 0 done, 2 bad arguments (nothing read).
 */
export async function runPepperStatus(input: PepperStatusInput): Promise<number> {
  const json = input.argv.length === 1 && input.argv[0] === '--json';
  if (input.argv.length > 0 && !json) {
    input.stderr.write(PEPPER_STATUS_USAGE);
    return 2;
  }
  const counts = new Map(
    (await countApiKeysByPepper(input.db)).map(({ pepperKeyId, count }) => [pepperKeyId, count]),
  );
  const currentId = apiKeyPepperId(input.current);
  const earlierIds = [...new Set(input.previous.map((pepper) => apiKeyPepperId(pepper)))].filter(
    (id) => id !== currentId,
  );
  const configured = new Set([currentId, ...earlierIds]);
  const status: PepperStatus = {
    current: { 'pepper-id': currentId, keys: counts.get(currentId) ?? 0 },
    earlier: earlierIds.map((id) => ({ 'pepper-id': id, keys: counts.get(id) ?? 0 })),
    'not-proved': counts.get(null) ?? 0,
    'not-configured': [...counts.entries()].flatMap(([id, count]) =>
      id === null || configured.has(id) ? [] : [{ 'pepper-id': id, keys: count }],
    ),
  };
  input.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : words(status));
  return 0;
}
