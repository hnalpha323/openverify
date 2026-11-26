/**
 * C268.3 (Workflow 11D load-harness): the steps of `seed:load`, in order. Each writes through the
 * repositories (and the list and transaction key functions the API uses), so the stack reads what
 * its own routes would have written; each records what the scenarios need in the seed record. Every
 * value is synthetic: names from the generators, emails at example.com, documentation addresses.
 */
import { API_SCOPES, type CreateInquiryTemplateAttributes } from '@openverify/contracts';
import {
  confirmMfaFactor,
  createAccount,
  createApiKey,
  createConnection,
  createEnvironment,
  createGraphQueryTemplate,
  createInquiry,
  createInquiryTemplate,
  createList,
  createOrganization,
  createTotpFactor,
  createUser,
  createWebhook,
  generateApiKey,
  listReportTemplates,
  publishGraphQueryTemplateVersion,
  setOrganizationConnectInbound,
  setUserRoles,
  updateEnvironmentSettings,
  type EnvironmentKind,
} from '@openverify/db';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../operator-auth/index.js';
import { newTotpSecret } from '../../operator-auth/totp.js';
import { DEFAULT_TOTP_FACTOR_NAME } from '../../services/mfa.js';
import { syncOrganizationRoles } from '../../services/roles.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { SAMPLE_SHARE_POLICY } from '../connect-seed.js';
import {
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_TEMPLATE_SETTINGS,
  loadTemplateAttributes,
} from '../dev-seed.js';
import { seedReportTemplates } from '../report-templates.js';
import type { LoadSeedOptions } from '../load-seed.js';
import {
  ENVIRONMENT_KINDS,
  KEY_POOLS,
  LOAD_ORGANISATIONS,
  MAIN_ORGANISATIONS,
  SPREAD_ORGANISATIONS,
  countsFor,
  partsOf,
  production,
  sandbox,
  scaled,
  type LoadStep,
} from './counts.js';
import {
  seedListsStep,
  seedTransactionsStep,
  IMPORT_LIST_KINDS,
  transactionTypeStep,
} from './lists.js';
import { addIds, addKeys, environmentOf, type LoadSeedRecord } from './record.js';
import { seedWatchlistsStep, watchlistParts } from './watchlists.js';

export interface LoadStepContext extends LoadSeedOptions {
  record: LoadSeedRecord;
}

export interface LoadStepResult {
  /** What the step wrote, by name: counts only. */
  counts: Record<string, number>;
  /** The step's parts (1 when it has none). */
  parts: number;
  /** `false` when the call only planned (`--part 0`): nothing is marked done. */
  complete?: boolean;
}

/** The step was asked for something it cannot do; the message says what to run instead. */
export class LoadStepError extends Error {
  override name = 'LoadStepError';
}

const BATCH = 500;

/** A raw statement's rows (drizzle types `execute` loosely). */
export const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows;

/** The load organisations' inquiry template: the default one, with Play Integrity's notice beside
 * the session-integrity notice (the stack binds the sandbox deviceIntegrity provider, C211.9). */
export async function loadTemplate(): Promise<CreateInquiryTemplateAttributes> {
  const template = await loadTemplateAttributes(DEFAULT_TEMPLATE_PATH);
  return {
    ...template,
    name: 'Load template',
    flow: {
      ...template.flow,
      steps: template.flow.steps.map((step) =>
        step.type === 'consent' && !step.textKeys.includes('notice.play-integrity')
          ? { ...step, textKeys: [...step.textKeys, 'notice.play-integrity'] }
          : step,
      ),
    },
  } as CreateInquiryTemplateAttributes;
}

/** C102.2: the graph template the load's queries run, from an account over the email kind. */
export const LOAD_GRAPH_TEMPLATE_CONFIG = Object.freeze({
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address'],
  'max-hops': 2,
});

/** Where the stack's worker reaches the host's webhook receiver (`load/receiver.py`). */
export const LOAD_WEBHOOK_URL = 'http://host.docker.internal:28080/hook';

async function organisationsStep(ctx: LoadStepContext): Promise<LoadStepResult> {
  const { db, ids, clock, record } = ctx;
  let created = 0;
  for (const label of LOAD_ORGANISATIONS) {
    if (record.organisations[label] !== undefined) {
      continue;
    }
    await db.transaction(async (tx) => {
      // The shipped default: require-mfa on (C168.2); every console user gets a TOTP factor.
      const organisation = await createOrganization(tx, {
        id: ids.newId('org'),
        name: `Load ${label}`,
      });
      record.organisations[label] = organisation.id;
      for (const kind of ENVIRONMENT_KINDS) {
        const environment = await createEnvironment(tx, {
          id: ids.newId('env'),
          organizationId: organisation.id,
          kind,
        });
        record.environments[`${label} ${kind}`] = environment.id;
      }
      await syncOrganizationRoles(tx, organisation.id, ids);
    });
    created += 1;
  }
  // C231.10: the destination of the load's connection receives connections.
  await setOrganizationConnectInbound(db, record.organisations['load-b'] ?? '', true);
  await reconcileWatchlistSources(db, {
    disabled: [...ctx.settings.watchlistSourcesDisabled],
    clock,
  });
  const template = await loadTemplate();
  for (const label of LOAD_ORGANISATIONS) {
    const environments = {
      sandbox: environmentOf(record, sandbox(label)),
      production: environmentOf(record, production(label)),
    };
    await seedReportTemplates(db, { environments, ids, clock });
    for (const kind of ENVIRONMENT_KINDS) {
      const page = await listReportTemplates(db, environments[kind], { size: 100 });
      const watchlist = page.items.find((item) => item.reportType === 'watchlist');
      if (watchlist !== undefined) {
        record.refs[`watchlist-template:${label} ${kind}`] = watchlist.id;
      }
    }
    if (record.refs[`template:${label}`] === undefined) {
      const created = await createInquiryTemplate(db, environments.sandbox, {
        id: ids.newId('itmpl'),
        name: template.name,
        version: {
          id: ids.newId('itmplv'),
          flow: template.flow,
          verificationConfig: template['verification-config'],
          settings: { ...DEFAULT_TEMPLATE_SETTINGS, ...template.settings },
        },
      });
      record.refs[`template:${label}`] = created.id;
      record.refs[`template-version:${label}`] = created.currentVersion.id;
    }
  }
  for (const organisation of SPREAD_ORGANISATIONS.slice(0, 8)) {
    for (const kind of ENVIRONMENT_KINDS) {
      const label = `${organisation} ${kind}`;
      if (record.refs[`graph-template:${label}`] !== undefined) {
        continue;
      }
      const environmentId = environmentOf(record, label);
      // C102: the graph indexes this environment (the default, written out).
      await updateEnvironmentSettings(db, environmentId, { 'graph-indexing': true });
      const versionId = ids.newId('grqtv');
      const graphTemplate = await createGraphQueryTemplate(db, environmentId, {
        id: ids.newId('grqt'),
        name: 'Load account neighbourhood',
        version: { id: versionId, config: { ...LOAD_GRAPH_TEMPLATE_CONFIG } },
      });
      await publishGraphQueryTemplateVersion(db, environmentId, versionId, clock.now());
      record.refs[`graph-template:${label}`] = graphTemplate.id;
    }
  }
  for (const organisation of SPREAD_ORGANISATIONS.slice(12, 16)) {
    const label = sandbox(organisation);
    for (const [route, kind] of IMPORT_LIST_KINDS) {
      if (record.refs[`import-list:${route}:${label}`] !== undefined) {
        continue;
      }
      const list = await createList(db, environmentOf(record, label), {
        id: ids.newId('lst'),
        type: kind,
        name: `Load import ${route}`,
        screenAtCompletion: false,
        ...(kind === 'name' ? { allowFuzzyNameFirst: true } : {}),
      });
      record.refs[`import-list:${route}:${label}`] = list.id;
    }
  }
  if (record.refs['webhook:load-b'] === undefined) {
    const webhook = await createWebhook(db, environmentOf(record, sandbox('load-b')), {
      id: ids.newId('wbh'),
      url: LOAD_WEBHOOK_URL,
      enabledEvents: ['inquiry.created'],
      secret: `whsec_${randomBytes(24).toString('base64url')}`,
      name: 'Load webhook receiver',
    });
    record.refs['webhook:load-b'] = webhook.id;
  }
  await transactionTypeStep(ctx);
  return { counts: { organisations: created, environments: created * 2 }, parts: 1 };
}

const keyKind = (label: string): EnvironmentKind =>
  label.endsWith(' production') ? 'production' : 'sandbox';

/** The documentation address console user `n` signs in from (2001:db8:4c00::/40, one each). */
export const userAddress = (n: number) => `2001:db8:4c00::${(n + 1).toString(16)}`;

async function principalsStep(ctx: LoadStepContext): Promise<LoadStepResult> {
  const { db, ids, clock, record, settings, args } = ctx;
  let keys = 0;
  for (const pool of KEY_POOLS) {
    if ((record.keys[pool.pool]?.length ?? 0) > 0) {
      continue;
    }
    const count = scaled(pool.count, args.scale);
    const made = [];
    for (let i = 0; i < count; i += 1) {
      const environment = pool.environments[i % pool.environments.length] ?? '';
      const generated = generateApiKey(keyKind(environment), settings.pepper);
      await createApiKey(db, environmentOf(record, environment), {
        id: ids.newId('key'),
        name: `Load ${pool.pool} ${String(i + 1)}`,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        tokenPrefix: generated.tokenPrefix,
        scopes: [...API_SCOPES],
      });
      made.push({ token: generated.token, environment });
    }
    addKeys(record, pool.pool, made);
    keys += made.length;
  }
  let users = 0;
  if (record.users.length === 0) {
    const total = countsFor(args.scale).users;
    // One synthetic password for every load user, hashed once (Argon2id): each sign-in still
    // verifies it, which is what the console-login row measures.
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await hashPassword(password);
    for (const [index, organisation] of MAIN_ORGANISATIONS.entries()) {
      const organizationId = record.organisations[organisation] ?? '';
      const roles = await syncOrganizationRoles(db, organizationId, ids);
      const admin = roles.find((role) => role.key === 'admin')?.id ?? '';
      for (let i = index; i < total; i += MAIN_ORGANISATIONS.length) {
        const email = `load-user-${String(i)}@example.com`;
        const secret = newTotpSecret();
        await db.transaction(async (tx) => {
          const user = await createUser(tx, {
            id: ids.newId('usr'),
            organizationId,
            email,
            passwordHash,
            name: `Load user ${String(i)}`,
          });
          await setUserRoles(tx, organizationId, user.id, [admin]);
          const factor = await createTotpFactor(tx, organizationId, {
            id: ids.newId('mfa'),
            userId: user.id,
            name: DEFAULT_TOTP_FACTOR_NAME,
            secret,
          });
          await confirmMfaFactor(tx, organizationId, factor.id, { at: clock.now() });
        });
        record.users.push({
          email,
          password,
          'totp-secret': secret,
          organisation,
          address: userAddress(i),
        });
        users += 1;
      }
    }
  }
  return { counts: { keys, users }, parts: 1 };
}

/** Creates `count` accounts in an environment, in batches; returns their ids in order. */
async function accountsIn(
  ctx: LoadStepContext,
  environmentId: string,
  count: number,
  prefix: string,
): Promise<string[]> {
  const made: string[] = [];
  for (let start = 0; start < count; start += BATCH) {
    await ctx.db.transaction(async (tx) => {
      for (let i = start; i < Math.min(count, start + BATCH); i += 1) {
        const account = await createAccount(tx, environmentId, {
          id: ctx.ids.newId('acc'),
          referenceId: `${prefix}-${String(i)}`,
        });
        made.push(account.id);
      }
    });
  }
  return made;
}

async function accountsStep(ctx: LoadStepContext): Promise<LoadStepResult> {
  const { record, args } = ctx;
  const counts = countsFor(args.scale);
  const result: Record<string, number> = {};
  if ((record.ids.accounts?.length ?? 0) === 0) {
    addIds(
      record,
      'accounts',
      await accountsIn(
        ctx,
        environmentOf(record, sandbox('load-a')),
        counts.accounts,
        'load-account',
      ),
    );
    result.accounts = counts.accounts;
  }
  const exporters = SPREAD_ORGANISATIONS.slice(4, 10);
  for (const organisation of exporters) {
    const label = sandbox(organisation);
    if ((record.ids[`export-accounts:${label}`]?.length ?? 0) > 0) {
      continue;
    }
    const each = Math.max(1, Math.ceil(counts.exportAccounts / exporters.length));
    addIds(
      record,
      `export-accounts:${label}`,
      await accountsIn(ctx, environmentOf(record, label), each, `load-export-${organisation}`),
    );
    result.exportAccounts = (result.exportAccounts ?? 0) + each;
  }
  for (const organisation of SPREAD_ORGANISATIONS.slice(0, 8)) {
    for (const kind of ENVIRONMENT_KINDS) {
      const label = `${organisation} ${kind}`;
      if ((record.ids[`graph-accounts:${label}`]?.length ?? 0) > 0) {
        continue;
      }
      addIds(
        record,
        `graph-accounts:${label}`,
        await accountsIn(
          ctx,
          environmentOf(record, label),
          counts.graphAccounts,
          `load-graph-${organisation}-${kind}`,
        ),
      );
      result.graphAccounts = (result.graphAccounts ?? 0) + counts.graphAccounts;
    }
  }
  return { counts: result, parts: 1 };
}

/** One pool of inquiries the inquiries step writes: its id pool, status, environment and size. */
interface InquiryPool {
  name: string;
  status: 'approved' | 'needs_review' | 'created';
  organisation: string;
  count: number;
  /** The accounts its inquiries are spread over (none: one new account each). */
  accounts?: readonly string[];
}

export function inquiryPools(
  record: LoadSeedRecord,
  scale: LoadSeedRecord['scale'],
): InquiryPool[] {
  const counts = countsFor(scale);
  const accounts = record.ids.accounts ?? [];
  const pools: InquiryPool[] = [
    {
      name: 'settled-inquiries',
      status: 'approved',
      organisation: 'load-a',
      count: counts.settledInquiries,
      accounts,
    },
    {
      name: 'review-inquiries',
      status: 'needs_review',
      organisation: 'load-a',
      count: counts.reviewInquiries,
      accounts,
    },
    {
      name: 'write-inquiries',
      status: 'created',
      organisation: 'load-a',
      count: counts.writeInquiries,
      accounts,
    },
    {
      name: 'flow-inquiries',
      status: 'created',
      organisation: 'load-a',
      count: counts.flowInquiries,
    },
    {
      name: 'verification-inquiries',
      status: 'created',
      organisation: 'load-a',
      count: counts.verificationInquiries,
    },
    {
      name: 'connect-source-inquiries',
      status: 'approved',
      organisation: 'load-a',
      count: counts.connectSources,
    },
  ];
  for (const organisation of SPREAD_ORGANISATIONS.slice(4, 10)) {
    const exported = record.ids[`export-accounts:${sandbox(organisation)}`] ?? [];
    pools.push({
      name: `export-inquiries:${sandbox(organisation)}`,
      status: 'approved',
      organisation,
      count: exported.length * counts.exportInquiries,
      accounts: exported,
    });
  }
  return pools;
}

/** The slice [from, to) of the concatenation of `pools` (a part of the inquiries step). */
export function sliceOfPools(
  pools: readonly InquiryPool[],
  from: number,
  to: number,
): { pool: InquiryPool; from: number; to: number }[] {
  const slices: { pool: InquiryPool; from: number; to: number }[] = [];
  let offset = 0;
  for (const pool of pools) {
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + pool.count);
    if (start < end) {
      slices.push({ pool, from: start - offset, to: end - offset });
    }
    offset += pool.count;
  }
  return slices;
}

const totalOf = (pools: readonly InquiryPool[]) => pools.reduce((sum, pool) => sum + pool.count, 0);

/** Resolves which part to run: `--part 0` plans, none runs the only part, else part `n`. */
function partToRun(step: LoadStep, part: number | undefined, parts: number): number | 'plan' {
  if (part === 0) {
    return 'plan';
  }
  if (part === undefined) {
    if (parts > 1) {
      throw new LoadStepError(
        `--step ${step} has ${String(parts)} parts: run --part 1 to ${String(parts)}`,
      );
    }
    return 1;
  }
  if (part > parts) {
    throw new LoadStepError(
      `--step ${step} has ${String(parts)} parts; --part ${String(part)} is past them`,
    );
  }
  return part;
}

async function inquiriesStep(
  ctx: LoadStepContext,
  part: number | undefined,
): Promise<LoadStepResult> {
  const { db, ids, record, args } = ctx;
  const pools = inquiryPools(record, args.scale);
  const total = totalOf(pools);
  const parts = partsOf(total);
  const run = partToRun('inquiries', part, parts);
  if (run === 'plan') {
    return { counts: { inquiries: total }, parts, complete: false };
  }
  const size = Math.ceil(total / parts);
  const counts: Record<string, number> = {};
  for (const slice of sliceOfPools(pools, (run - 1) * size, run * size)) {
    const { pool } = slice;
    const environmentId = environmentOf(record, sandbox(pool.organisation));
    const templateId = record.refs[`template:${pool.organisation}`] ?? '';
    const versionId = record.refs[`template-version:${pool.organisation}`] ?? '';
    for (let start = slice.from; start < slice.to; start += BATCH) {
      const made: string[] = [];
      await db.transaction(async (tx) => {
        for (let i = start; i < Math.min(slice.to, start + BATCH); i += 1) {
          const account = pool.accounts?.length
            ? pool.accounts[i % pool.accounts.length]
            : undefined;
          const inquiry = await createInquiry(tx, environmentId, {
            id: ids.newId('inq'),
            inquiryTemplateId: templateId,
            inquiryTemplateVersionId: versionId,
            ...(account === undefined
              ? { referenceId: `load-${pool.name}-${String(i)}` }
              : { accountId: account }),
            expiresAt: new Date(ctx.clock.now().getTime() + 30 * 24 * 3600 * 1000),
          });
          made.push(inquiry.id);
        }
        if (pool.status !== 'created') {
          await tx.execute(sql`update inquiries set status = ${pool.status}, completed_at = now()
            where environment_id = ${environmentId} and id in (${sql.join(
              made.map((id) => sql`${id}`),
              sql`, `,
            )})`);
        }
      });
      addIds(record, pool.name, made);
      counts[pool.name] = (counts[pool.name] ?? 0) + made.length;
    }
  }
  return { counts, parts };
}

async function connectStep(ctx: LoadStepContext): Promise<LoadStepResult> {
  const { db, ids, clock, record } = ctx;
  if (record.refs['connect-connection'] !== undefined) {
    return { counts: {}, parts: 1 };
  }
  const source = record.organisations['load-a'] ?? '';
  const destination = record.organisations['load-b'] ?? '';
  const creator = rowsOf<{ id: string }>(
    await db.execute(
      sql`select id from users where organization_id = ${source} order by id limit 1`,
    ),
  )[0]?.id;
  if (creator === undefined) {
    throw new LoadStepError('the connect step needs the principals step first (a load-a user)');
  }
  const { connection } = await db.transaction((tx) =>
    createConnection(tx, {
      id: ids.newId('cxn'),
      sourceOrganizationId: source,
      destinationOrganizationId: destination,
      creatorType: 'user',
      creatorId: creator,
      policyId: ids.newId('cxnp'),
      policy: { ...SAMPLE_SHARE_POLICY },
      createdAt: clock.now(),
    }),
  );
  // C231.3: an activation is the destination's act in the console; the load's connection is
  // made active here, as the e2e stack's is after its console step.
  await db.execute(sql`update connect_connections set status = 'active', activated_at = now()
    where id = ${connection.id}`);
  record.refs['connect-connection'] = connection.id;
  return {
    counts: { connections: 1, sources: record.ids['connect-source-inquiries']?.length ?? 0 },
    parts: 1,
  };
}

function graphStep(ctx: LoadStepContext): LoadStepResult {
  // The graph's backfill (the worker's graph-backfill, every 60 s while an index state is
  // incomplete) indexes the seeded accounts; this step only checks the templates are in place.
  const labels = SPREAD_ORGANISATIONS.slice(0, 8).flatMap((organisation) =>
    ENVIRONMENT_KINDS.map((kind) => `${organisation} ${kind}`),
  );
  const missing = labels.filter(
    (label) => ctx.record.refs[`graph-template:${label}`] === undefined,
  );
  if (missing.length > 0) {
    throw new LoadStepError('the graph step needs the organisations step first');
  }
  return { counts: { graphEnvironments: labels.length }, parts: 1 };
}

/** What the record must hold after every step, with the database's own counts beside it. */
async function verifyStep(ctx: LoadStepContext): Promise<LoadStepResult> {
  const { db, record } = ctx;
  const counts: Record<string, number> = {};
  for (const pool of KEY_POOLS) {
    counts[`keys:${pool.pool}`] = record.keys[pool.pool]?.length ?? 0;
    if (counts[`keys:${pool.pool}`] !== scaled(pool.count, record.scale)) {
      throw new LoadStepError(`the key pool ${pool.pool} is not complete: run --step principals`);
    }
  }
  counts.users = record.users.length;
  const environments = Object.values(record.environments);
  const rows = rowsOf<{ inquiries: number; accounts: number; keys: number }>(
    await db.execute(sql`select
      (select count(*) from inquiries where environment_id in (${sql.join(
        environments.map((id) => sql`${id}`),
        sql`, `,
      )}))::int as inquiries,
      (select count(*) from accounts where environment_id in (${sql.join(
        environments.map((id) => sql`${id}`),
        sql`, `,
      )}))::int as accounts,
      (select count(*) from api_keys where environment_id in (${sql.join(
        environments.map((id) => sql`${id}`),
        sql`, `,
      )}))::int as keys`),
  );
  const [found] = rows;
  counts.inquiries = found?.inquiries ?? 0;
  counts.accounts = found?.accounts ?? 0;
  counts.databaseKeys = found?.keys ?? 0;
  const recorded = Object.entries(record.ids)
    .filter(([name]) => name.endsWith('inquiries') || name.startsWith('export-inquiries:'))
    .reduce((sum, [, values]) => sum + values.length, 0);
  if (recorded !== counts.inquiries) {
    throw new LoadStepError(
      `the record lists ${String(recorded)} inquiries and the database holds ${String(counts.inquiries)}: finish every part of --step inquiries`,
    );
  }
  counts.organisations = Object.keys(record.organisations).length;
  return { counts, parts: 1 };
}

/** Runs one step of `seed:load` against the record in `ctx`. */
export async function runLoadStep(
  ctx: LoadStepContext,
  step: LoadStep,
  part: number | undefined,
): Promise<LoadStepResult> {
  switch (step) {
    case 'organisations':
      return organisationsStep(ctx);
    case 'principals':
      return principalsStep(ctx);
    case 'accounts':
      return accountsStep(ctx);
    case 'inquiries':
      return inquiriesStep(ctx, part);
    case 'lists':
      return seedListsStep(ctx);
    case 'transactions': {
      const parts = partsOf(countsFor(ctx.args.scale).transactions);
      const run = partToRun('transactions', part, parts);
      return run === 'plan'
        ? {
            counts: { transactions: countsFor(ctx.args.scale).transactions },
            parts,
            complete: false,
          }
        : seedTransactionsStep(ctx, run, parts);
    }
    case 'graph':
      return Promise.resolve(graphStep(ctx));
    case 'connect':
      return connectStep(ctx);
    case 'watchlists': {
      const parts = watchlistParts(ctx.args.scale);
      const run = partToRun('watchlists', part, parts);
      return run === 'plan'
        ? { counts: {}, parts, complete: false }
        : seedWatchlistsStep(ctx, run, parts);
    }
    case 'verify':
      return verifyStep(ctx);
  }
}
