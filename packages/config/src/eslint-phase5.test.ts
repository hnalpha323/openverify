/**
 * C53.8, C58.7: the Phase 5 folders' lint rules, run with ESLint's `Linter` on synthetic code (the
 * type-aware root config needs files on disk; these rules need no types).
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import {
  PHASE5_FOLDERS,
  REDACTED_PERSONAL_LOG_KEYS,
  phase5Config,
} from '../eslint/phase5-rules.js';

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  ...phase5Config(),
];

function lint(code: string, filename: string) {
  return linter
    .verify(code, config, { filename })
    .map((message) => ({ rule: message.ruleId, line: message.line }));
}

const OTP_FILE = 'apps/api/src/services/otp/send.ts';
const LOG = (object: string) =>
  `declare const log: { info(o: object, m: string): void };\nlog.info(${object}, 'sent');\n`;

describe('the Workflow 7B folders (C53.8, C107.5)', () => {
  it.each([
    'apps/api/src/services/lists/match.ts',
    'apps/api/src/services/lists/biometric/cache.ts',
    'apps/api/src/services/importers/parse.ts',
    'apps/api/src/services/graph/query.ts',
    'apps/api/src/services/transactions/create.ts',
    'apps/api/src/jobs/lists/screen.ts',
    'apps/api/src/jobs/importers/process.ts',
    'apps/api/src/jobs/graph/index-job.ts',
    'apps/api/src/routes/server/lists.ts',
    'apps/api/src/routes/server/list-items.ts',
    'apps/api/src/routes/server/list-matches.ts',
    'apps/api/src/routes/server/importers.ts',
    'apps/api/src/routes/server/graph-queries.ts',
    'apps/api/src/routes/server/graph-query-templates.ts',
    'apps/api/src/routes/server/graph-query-template-versions.ts',
    'apps/api/src/routes/server/transactions.ts',
    'apps/api/src/routes/server/transaction-types.ts',
    'apps/api/src/routes/server/transaction-type-versions.ts',
    'packages/checks/src/lists/keys.ts',
    'packages/checks/src/csv/writer.ts',
    'packages/core/src/transactions/validate.ts',
  ])('applies the log rule and the regexp style rules in %s', (file) => {
    expect(lint(LOG("{ code: '123456' }"), file)).toContainEqual({
      rule: 'no-restricted-syntax',
      line: 2,
    });
    expect(lint('export const STYLE = /[0-9]/;\n', file).map(({ rule }) => rule)).toContain(
      'regexp/prefer-d',
    );
  });

  it.each([
    "{ parameterMap: { email: 'person@example.test' } }",
    "{ 'parameter-map': {} }",
    '{ variableMap: {} }',
    '{ params: {} }',
    "{ filename: 'list.csv' }",
    "{ fileName: 'list.csv' }",
    "{ 'file-name': 'list.csv' }",
    "{ row: 'a,b' }",
    "{ rows: ['a,b'] }",
    "{ csvRow: 'a,b' }",
    "{ record: { value: 'a' } }",
    "{ matchedValue: 'a' }",
    "{ dismissalReason: 'a' }",
  ])('refuses a 7B value name in a log call: %s', (object) => {
    expect(lint(LOG(object), 'apps/api/src/services/importers/parse.ts')).toContainEqual({
      rule: 'no-restricted-syntax',
      line: 2,
    });
  });

  it('keeps counts and ids of 7B: a row count, a line, a code-free id', () => {
    expect(
      lint(
        LOG("{ importerId: 'mprt_x', rowCount: 3, line: 2, errorCode: 'invalid_value' }"),
        'apps/api/src/services/importers/parse.ts',
      ),
    ).toEqual([]);
  });
});

describe('the Workflow 8B folders (C143.5)', () => {
  it.each([
    'packages/core/src/cases/case-state-machine.ts',
    'apps/api/src/services/cases/cases.ts',
    'apps/api/src/services/cases/sla/business-time.ts',
    'apps/api/src/jobs/cases/rendition.ts',
    'apps/api/src/providers/attachment-scanner/clamd.ts',
    'apps/api/src/routes/server/cases.ts',
    'apps/api/src/routes/server/case-comments.ts',
    'apps/api/src/routes/server/case-attachments.ts',
    'apps/api/src/routes/server/case-exports.ts',
    'apps/api/src/routes/server/case-assignment.ts',
    'apps/api/src/routes/server/case-calendars.ts',
    'apps/api/src/jobs/repeatable/cases.ts',
    'apps/api/src/routes/server/inquiry-review-requests.ts',
    'apps/api/src/routes/dashboard/notifications.ts',
    'apps/api/src/routes/dashboard/file-renditions.ts',
  ])('applies the log rule and the regexp style rules in %s', (file) => {
    expect(lint(LOG("{ code: '123456' }"), file)).toContainEqual({
      rule: 'no-restricted-syntax',
      line: 2,
    });
    expect(lint('export const STYLE = /[0-9]/;\n', file).map(({ rule }) => rule)).toContain(
      'regexp/prefer-d',
    );
  });

  it.each(["{ statement: 'a' }", "{ statements: ['a'] }", "{ mentions: ['a'] }"])(
    "refuses a person's words or who they named in a log call: %s",
    (properties) => {
      expect(lint(LOG(properties), 'apps/api/src/services/cases/cases.ts')).toContainEqual({
        rule: 'no-restricted-syntax',
        line: 2,
      });
    },
  );
});

describe('the Workflow 8A folders (C117.11, C143.5)', () => {
  it.each([
    'packages/workflow-engine/src/expressions/evaluate.ts',
    'packages/workflow-engine/src/code-runner/pool.ts',
    'packages/workflow-engine/bin/code-runner-child.ts',
    'apps/api/src/workflows/engine/executor.ts',
    'apps/api/src/workflows/actions/https/request.ts',
    'apps/api/src/jobs/workflows/step.ts',
    'apps/api/src/services/decisions/record.ts',
    'apps/api/src/services/workflow-secrets/secrets.ts',
    'apps/api/src/routes/server/workflows.ts',
    'apps/api/src/routes/server/workflow-runs.ts',
    'apps/api/src/routes/server/workflow-secrets.ts',
    'apps/api/src/routes/server/account-actions.ts',
    'apps/api/src/routes/server/inquiry-decisions.ts',
    'apps/api/src/routes/server/sandbox-messages.ts',
  ])('applies the log rule and the regexp style rules in %s', (file) => {
    expect(lint(LOG("{ code: '123456' }"), file)).toContainEqual({
      rule: 'no-restricted-syntax',
      line: 2,
    });
    expect(lint('export const STYLE = /[0-9]/;\n', file).map(({ rule }) => rule)).toContain(
      'regexp/prefer-d',
    );
  });

  it.each([
    '{ variables: { risk: 1 } }',
    "{ variable: 'a' }",
    "{ output: { value: 'a' } }",
    '{ outputs: {} }',
    '{ triggerSnapshot: {} }',
    "{ templateOutput: 'a' }",
    "{ secret: 'a' }",
    '{ secrets: [] }',
    "{ body: '{}' }",
    "{ responseBody: '{}' }",
    "{ comment: 'a' }",
  ])('refuses a run value in a log call: %s', (object) => {
    expect(lint(LOG(object), 'apps/api/src/workflows/engine/executor.ts')).toContainEqual({
      rule: 'no-restricted-syntax',
      line: 2,
    });
  });

  it('keeps ids, node ids, action keys, outcomes, durations and error types (C117.11)', () => {
    expect(
      lint(
        LOG(
          "{ runId: 'wfr_x', nodeId: 'run_watchlist', actionKey: 'run_report', outcome: 'failed', durationMs: 3, errorType: 'resource-error' }",
        ),
        'apps/api/src/workflows/engine/executor.ts',
      ),
    ).toEqual([]);
  });
});

describe('the Phase 5 lint rules', () => {
  it.each([
    "{ phoneNumber: '+15555550100' }",
    "{ email: 'person@example.test' }",
    "{ 'email-address': 'person@example.test' }",
    "{ destination: 'person@example.test' }",
    "{ code: '123456' }",
    "{ verificationId: 'ver_x', send: { otp: '123456' } }",
    "{ walletAddressRaw: '0x00' , address: '0x00' }",
    "{ signature: '0xab' }",
    "{ values: { 'name-first': 'Synthetic' } }",
  ])('refuses a personal name in a log call in a Phase 5 folder: %s', (object) => {
    expect(lint(LOG(object), OTP_FILE)).toContainEqual({ rule: 'no-restricted-syntax', line: 2 });
  });

  it.each([
    "{ verificationId: 'ver_x', channel: 'sms', sends: 1 }",
    "{ pii: { phoneNumber: '+15555550100' } }",
    ...REDACTED_PERSONAL_LOG_KEYS.map((key) => `{ ${key}: 'synthetic' }`),
    "{ err: new Error('boom'), errorCode: 'upstream_down' }",
  ])('allows ids, counts, pii and the redacted names: %s', (object) => {
    expect(lint(LOG(object), OTP_FILE)).toEqual([]);
  });

  it('applies only in the Phase 5 folders', () => {
    expect(lint(LOG("{ code: '123456' }"), 'apps/api/src/services/flow.ts')).toEqual([]);
  });

  it('refuses super-linear regular expressions in the matching folders', () => {
    const messages = lint(
      'export const RUNAWAY = /^(a+)+$/;\nexport const MOVE = /a*b/;\n',
      'packages/checks/src/matching/names.ts',
    );

    expect(messages.map((message) => message.rule)).toEqual(
      expect.arrayContaining(['regexp/no-super-linear-backtracking']),
    );
  });

  it.each([
    'packages/watchlist/src/parsers/ofac.ts',
    'packages/checks/src/reports/email/typos.ts',
    // Workflow 6A Stage 1b: the API folders that hold report subjects, matches and articles.
    'apps/api/src/services/reports/completion.ts',
    'apps/api/src/jobs/reports/run.ts',
    'apps/api/src/jobs/report-types/watchlist.ts',
    'apps/api/src/watchlists/sync.ts',
    'apps/api/src/providers/adverse-media/gdelt.ts',
    'apps/api/src/providers/email-intelligence/hibp.ts',
    'apps/api/src/providers/phone-intelligence/twilio-lookup.ts',
    'apps/api/src/providers/address-verification/smarty.ts',
    'apps/api/src/providers/crypto-exposure/sandbox.ts',
    'apps/api/src/routes/server/reports.ts',
  ])(
    'refuses them in the Phase 6 folders that read untrusted lists and subjects too: %s',
    (file) => {
      const messages = lint('export const RUNAWAY = /^(a+)+$/;\n', file);

      expect(messages.map((message) => message.rule)).toEqual(
        expect.arrayContaining(['regexp/no-super-linear-backtracking']),
      );
    },
  );

  const NETWORK_FILES = [
    'apps/api/src/network/evaluate.ts',
    'apps/api/src/sync/runner.ts',
    'apps/api/src/providers/ip-reputation/mmdb-file.ts',
    'apps/api/src/routes/dashboard/network-sources.ts',
    'packages/signals/src/network/lookups.ts',
  ];

  it.each(
    NETWORK_FILES.flatMap((file) =>
      [
        "{ ip: '192.0.2.10' }",
        "{ ipAddress: '192.0.2.10' }",
        "{ 'remote-address': '192.0.2.10' }",
        "{ clientAddress: '192.0.2.10' }",
        '{ latitude: 0.5, longitude: -30.5 }',
        "{ coordinates: '0.5,-30.5' }",
        "{ fingerprint: 'abc' }",
        "{ browserFingerprint: 'abc' }",
        "{ userAgent: 'SyntheticBrowser/1.0' }",
      ].map((object) => [file, object] as const),
    ),
  )(
    'refuses an address, a point, a fingerprint or a user agent outside pii in the Workflow 7A network folders (C93.7): %s %s',
    (file, object) => {
      expect(lint(LOG(object), file)).toContainEqual({ rule: 'no-restricted-syntax', line: 2 });
    },
  );

  it.each(NETWORK_FILES)(
    'refuses super-linear regular expressions in the Workflow 7A network folders too: %s',
    (file) => {
      const messages = lint('export const RUNAWAY = /^(a+)+$/;\n', file);

      expect(messages.map((message) => message.rule)).toEqual(
        expect.arrayContaining(['regexp/no-super-linear-backtracking']),
      );
    },
  );

  it.each(NETWORK_FILES)(
    'leaves the regexp style rules out of the Workflow 7A network folders, whose parsers predate the log rule: %s',
    (file) => {
      expect(
        lint('export const OCTET = /^[0-9]{1,3}$/;\nexport const TAG = /^[a-zA-Z]+$/;\n', file),
      ).toEqual([]);
    },
  );

  it('allows the network facts without the address there: the ASN, the country, the reasons (C93.7)', () => {
    expect(
      lint(
        LOG("{ sourceId: 'tor-exit-addresses', asn: 64496, country: 'ZZ', reason: 'list_stale' }"),
        'apps/api/src/network/evaluate.ts',
      ),
    ).toEqual([]);
    expect(lint(LOG("{ pii: { ip: '192.0.2.10' } }"), 'apps/api/src/network/evaluate.ts')).toEqual(
      [],
    );
  });

  it('is part of the root ESLint configuration for exactly the Phase 5 folders', async () => {
    // A URL in a variable: the root config is untyped JavaScript.
    const root = new URL('../../../eslint.config.js', import.meta.url).href;
    const rootConfig = ((await import(/* @vite-ignore */ root)) as { default: Linter.Config[] })
      .default;
    const phase5 = rootConfig.filter(
      (entry) => entry.files !== undefined && entry.files === PHASE5_FOLDERS,
    );

    expect(phase5).toHaveLength(1);
  });
});
