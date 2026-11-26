/**
 * `dashboard-graph`'s spec helpers (C108): the seeded roles signed in once for the file, a page
 * with a kept session, a published query template, accounts linked through shared account fields
 * (indexed in the same transaction as `POST /accounts`, C101.3) and a query run to its result.
 * The explorer's pages run under the console's real header policy (C170; DS18), so no spec injects
 * a policy of its own (K9-14).
 *
 * Every value is synthetic and made from the run's id: email addresses at `.test`, phone numbers
 * in the fictional UK drama range (+44 7700 900000 to 900999), fictional names spelled from
 * letters, and addresses on a made-up street.
 */
import type { GraphQueryTemplateConfig } from '@openverify/contracts';
import { createClient, type OpenVerifyClient } from '@openverify/node';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { signInAs } from './ui.js';

export type GraphRole = 'developer' | 'reviewer';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Signs each role in once and keeps its session: every sign-in attempt counts against the API's
 * login limits (C4), which the whole full-stack suite shares.
 */
export async function signedInGraphStates(
  browser: Browser,
  stack: StackInfo,
  roles: readonly GraphRole[],
): Promise<Record<GraphRole, StorageState>> {
  const states: Partial<Record<GraphRole, StorageState>> = {};
  for (const role of roles) {
    const context = await browser.newContext();
    try {
      await signInAs(await context.newPage(), stack, role);
      states[role] = await context.storageState();
    } finally {
      await context.close();
    }
  }
  return states as Record<GraphRole, StorageState>;
}

/** Runs `body` on a page signed in with a kept session, closing its context afterwards. */
export async function withConsolePage(
  browser: Browser,
  state: StorageState,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState: state });
  try {
    await body(await context.newPage());
  } finally {
    await context.close();
  }
}

/** The server API with the stack's key, retrying a 429 as the node client does. */
export function graphClient(stack: StackInfo): OpenVerifyClient {
  return createClient({ apiKey: stack.apiKey, baseUrl: stack.apiUrl, maxRetries: 4 });
}

/** A template whose first draft, named by the `latest-version` relationship, is published. */
export async function publishedTemplate(
  client: OpenVerifyClient,
  name: string,
  config: GraphQueryTemplateConfig,
): Promise<string> {
  const { data: template } = await client.graphQueryTemplates.create({ name, config });
  await client.graphQueryTemplates.versions.publish(
    template.relationships['latest-version']?.data.id ?? '',
  );
  return template.id;
}

/** A template from the account in context, over the account-field kinds a spec writes. */
export function accountFieldTemplate(
  maxHops: 2 | 4 | 6,
  nodeLimit: number,
): GraphQueryTemplateConfig {
  return {
    parameters: [{ name: 'account_id', kind: 'account_id' }],
    start: [{ kind: 'account_id', value: '{{account_id}}' }],
    'connect-kinds': [
      'email_address_unconfirmed',
      'phone_number_unconfirmed',
      'name_birthdate',
      'address',
    ],
    'max-hops': maxHops,
    'node-limit': nodeLimit,
  };
}

/** Lower-case letters for `n`, so a name never carries a digit the name analysis would drop. */
function letters(n: number): string {
  let text = '';
  let rest = n;
  do {
    text = String.fromCharCode(97 + (rest % 26)) + text;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return text;
}

/** The four account-field kinds a spec links accounts through. */
export type FieldKind = 'email' | 'phone' | 'name' | 'address';
export const FIELD_KINDS: readonly FieldKind[] = ['email', 'phone', 'name', 'address'];

/** The value number each kind an account holds; one number is one shared value of that kind. */
export type FieldPlan = Partial<Record<FieldKind, number>>;

/** The account fields of `plan`: each value number becomes the same synthetic value. */
export function fieldsOf(run: string, plan: FieldPlan, phoneBase: number): Record<string, string> {
  const fields: Record<string, string> = {};
  if (plan.email !== undefined) {
    fields.email_address = `g${run}-${String(plan.email)}@graph-ui.test`;
  }
  if (plan.phone !== undefined) {
    const number = (phoneBase + plan.phone) % 1000;
    fields.phone_number = `+447700900${String(number).padStart(3, '0')}`;
  }
  if (plan.name !== undefined) {
    fields.name_first = 'Ringtest';
    fields.name_last = `Q${letters(Number.parseInt(run, 16) % 17_576)}x${letters(plan.name)}`;
    fields.birthdate = '1990-01-01';
  }
  if (plan.address !== undefined) {
    fields.address_street_1 = `${String(plan.address + 1)} Synthetic Way`;
    fields.address_city = `Graphton ${letters(Number.parseInt(run, 16) % 17_576)}`;
    fields.address_subdivision = 'CA';
    fields.address_postal_code = '94000';
    fields.address_country_code = 'US';
  }
  return fields;
}

/** Creates one account per entry of `fields`, `concurrency` at a time, and answers their ids. */
export async function createAccounts(
  client: OpenVerifyClient,
  run: string,
  fields: readonly Record<string, string>[],
  concurrency = 12,
): Promise<string[]> {
  const ids: string[] = Array.from({ length: fields.length }, () => '');
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, fields.length) }, async () => {
      for (let index = next; index < fields.length; index = next) {
        next += 1;
        const { data } = await client.accounts.create({
          'reference-id': `ui-graph-${run}-${String(index)}`,
          fields: fields[index] ?? {},
        });
        ids[index] = data.id;
      }
    }),
  );
  return ids;
}

/**
 * The plan of a graph that a template from the root reaches past 2,000 nodes within 5 hops (one
 * node is an account or a shared value; a value joins a result only when two of its accounts hold
 * it, C102.4):
 * - the root shares one value of each kind with 48 accounts (49 holders, under the fan-out cap of
 *   50, C102.3);
 * - each of those uses its three other kinds: `uplinks` of them pair it with a new account each,
 *   the rest pair it with another of those 192;
 * - each new account pairs its three other kinds with other new accounts.
 * Every slot but the root's hubs is a pair, so the graph holds about three nodes per account.
 */
export function largeGraphPlan(uplinks: number): FieldPlan[] {
  const counters: Record<FieldKind, number> = { email: 0, phone: 0, name: 0, address: 0 };
  const value = (kind: FieldKind) => {
    counters[kind] += 1;
    return counters[kind];
  };
  const root: FieldPlan = {};
  const middle: FieldPlan[] = [];
  for (const kind of FIELD_KINDS) {
    root[kind] = value(kind);
    for (let index = 0; index < 48; index += 1) {
      middle.push({ [kind]: root[kind] });
    }
  }
  const outer: FieldPlan[] = [];
  const open: Record<FieldKind, FieldPlan[]> = { email: [], phone: [], name: [], address: [] };
  for (const kind of FIELD_KINDS) {
    for (const account of middle) {
      if (account[kind] !== undefined) {
        continue;
      }
      if (outer.length < uplinks) {
        const shared = value(kind);
        account[kind] = shared;
        outer.push({ [kind]: shared });
      } else {
        open[kind].push(account);
      }
    }
  }
  for (const account of outer) {
    for (const kind of FIELD_KINDS) {
      if (account[kind] === undefined) {
        open[kind].push(account);
      }
    }
  }
  // Pair what is left of each kind; an odd one keeps that kind empty.
  for (const kind of FIELD_KINDS) {
    const waiting = open[kind];
    for (let index = 0; index + 1 < waiting.length; index += 2) {
      const [one, other] = [waiting[index], waiting[index + 1]];
      if (one !== undefined && other !== undefined) {
        const shared = value(kind);
        one[kind] = shared;
        other[kind] = shared;
      }
    }
  }
  return [root, ...middle, ...outer];
}

/** Runs a query on the worker and waits for its result. */
export async function completedQuery(
  client: OpenVerifyClient,
  templateId: string,
  accountId: string,
  timeout = 30_000,
) {
  const { data: submitted } = await client.graphQueries.create({
    'graph-query-template-id': templateId,
    'parameter-map': { account_id: accountId },
  });
  let query = submitted;
  await expect
    .poll(
      async () => {
        query = (await client.graphQueries.retrieve(submitted.id)).data;
        return query.attributes.status;
      },
      { timeout, intervals: [250, 500, 1_000] },
    )
    .toBe('completed');
  return query;
}

/**
 * The scripts `page` has fetched so far, each with its text, to tell which chunks a view loads.
 * A dynamic chunk is in no route manifest, so only the browser can say when it is fetched.
 */
export function recordScripts(page: Page): () => Promise<string[]> {
  const scripts: Promise<string>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') {
      scripts.push(response.text());
    }
  });
  return () => Promise.all(scripts);
}

/**
 * Whether a script holds Cytoscape.js or fCoSE: an option name only Cytoscape.js's core reads, which
 * the explorer's own code never sets, and an identifier only layout-base and cose-base hold.
 */
export function holdsGraphLibrary(script: string): boolean {
  return script.includes('hideEdgesOnViewport') || script.includes('layoutBase');
}

/**
 * Records every CSP violation of `page`, from the document's `securitypolicyviolation` events
 * and the console's refusals.
 */
export async function recordCspViolations(page: Page): Promise<() => Promise<string[]>> {
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) {
      refusals.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => [
    ...refusals,
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )),
  ];
}
