/** Test-only helpers (Node APIs allowed; excluded from the build and the browser-safety scan). */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../contracts/fixtures');

/** Parses a golden fixture, e.g. `readFixture('api/inquiry.json')`. */
export function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, relativePath), 'utf8')) as unknown;
}

/** JSON fixtures in one fixture folder, sorted by name. */
export function listFixtures(folder: string): string[] {
  return readdirSync(path.join(FIXTURES_DIR, folder))
    .filter((file) => file.endsWith('.json'))
    .sort();
}

/** Synthetic IDs shared by the tests; they match the golden fixtures. */
export const IDS = {
  template: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
  templateVersion: 'itmplv_01M5A0GTG0VF5QW51511984D0G',
  inquiry: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
  governmentIdFailed: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
  governmentId: 'ver_01M5CK16P0D13FXHZSS4TCFBVH',
  selfie: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
  frontFailed: 'file_01M5CJZD282YV9958CG7ZK9ZKN',
  backFailed: 'file_01M5CJZE1G6XVZ8MHB9Y8SNWH3',
  front: 'file_01M5CK17N82ZP0PQ8RZRRTT5V5',
  back: 'file_01M5CK18MGP7DK00CDQ1KEB2N2',
  selfieCenter: 'file_01M5CK3288G5K9T8DC51K68DDZ',
  event: 'evt_01M5CK4VW0MRQ4HKKTBDT6PXEM',
  webhook: 'wbh_01M5CJXJF8RTHTZ2WC4QENGB0C',
  user: 'usr_01M5CJXHG03PHEQZPRWAH2RXM5',
  serverIntegration: 'key_01M5CJXHG0RVK7X4H9941FSM5K',
  otherInquiry: 'inq_01M5CJYRJ014A1YAHN815NCRBC',
  account: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8',
  otherAccount: 'acc_01M5CJXKEG99AP0TVPG669F8ND',
  sourceAccount: 'acc_01M5CJXMDRDXX8B44VMTRVSHYJ',
  secondSource: 'acc_01M5CJXMXCJJFTNDE0SFBE3V7Q',
  accountType: 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W',
  businessAccountType: 'acctp_01M5CJXJ2RVVMZ9ZRA2MG2PDJ1',
  role: 'role_01M5CJXHK40C71J91F792N0PV6',
  customRole: 'role_01M5CJXHP850SKWJAMBXN7B04B',
  userAuditLog: 'aud_01M5CK6PF09NC66VKSGJ7SN9DG',
  apiLog: 'alog_01M5CK707GE9YRH4WYN6TBZJPN',
  mfaFactor: 'mfa_01M5CK9R40JYHAVE63SVCY9VZT',
  totpFactor: 'mfa_01M5CKA1WGQK3X5QF8YFZ0J50Z',
  inquirySession: 'iqse_01M5CJZC30W7PFE0GD30HJWEA4',
  templateVersion2: 'itmplv_01M5CKS0D00R8HR9SJ7N456QK9',
  webhookDelivery: 'whd_01M5CK55MG5CV42K2QC9PQH0WE',
  approvedEvent: 'evt_01M5CKFVE0A1DPCWBWGY99VA5K',
  consolidatedEvent: 'evt_01M5CKJX30EP08Q5N1NJVW5KER',
  environment: 'env_01M5CJXHGAKAJV1EY6T7EEFWQX',
  productionEnvironment: 'env_01M5CJXHGMQZ5DBR7BYR0GR5S2',
  otherUser: 'usr_01M5CJXHGYWKQZM18G3CK32F27',
} as const;

export const AT = new Date('2026-10-20T12:00:00.000Z');
export const AT_ISO = '2026-10-20T12:00:00.000Z';
export const LATER = new Date('2026-10-20T12:04:00.000Z');
export const LATER_ISO = '2026-10-20T12:04:00.000Z';
export const LATEST = new Date('2026-10-20T12:30:00.000Z');
export const LATEST_ISO = '2026-10-20T12:30:00.000Z';

/** Synthetic tokens of each kind, never real. */
export const TOKENS = {
  session: `ovs_${'A'.repeat(43)}`,
  userSession: `ovu_${'A'.repeat(43)}`,
  oneTimeLink: `ovo_${'A'.repeat(43)}`,
  mfa: `ovm_${'A'.repeat(43)}`,
  invitation: `ovi_${'A'.repeat(43)}`,
} as const;

/** The issues of a failed parse as `path: message` strings, or `[]` when it succeeded. */
export function issuesOf(result: {
  success: boolean;
  error?: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } | undefined;
}): string[] {
  return (result.error?.issues ?? []).map(
    (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
  );
}
