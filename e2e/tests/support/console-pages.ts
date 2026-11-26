/**
 * Every console page, for the console sweep (Workflow 9C, `integration-9c`; C170.3, C171.2): the
 * page routes of the e2e build's route manifest (`src/console-routes.ts`), never a list written by
 * hand, and for each route with a dynamic segment a concrete URL found by following the console's
 * own links.
 *
 * `discoverConsolePages` reads the server HTML of every static page with an operator's session
 * (no rendering, so it is cheap), takes the first link that matches each dynamic route, then reads
 * each page it found the same way, until no new route turns up. A dynamic route that no link
 * reaches is reported as missing, and the sweep fails on it rather than skip it. The sweep runs
 * after the rest of the full-stack suite (its own Playwright project, `console-sweep`), when the
 * specs before it have made at least one object of each kind.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import {
  SIGNED_OUT_PAGES,
  dynamicRouteOf,
  isDynamicRoute,
  linksOf,
  pageRoutesOf,
} from '../../src/console-routes.js';
import { E2E_DASHBOARD_DIST_DIR } from '../../src/env.js';
import { REPO_ROOT } from '../../src/paths.js';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient } from './platform.js';

export { SIGNED_OUT_PAGES, isDynamicRoute };

const DIST = path.join(REPO_ROOT, 'apps', 'dashboard', E2E_DASHBOARD_DIST_DIR);

/** Every page route of the console's e2e build, sorted; read at collection time. */
export function consolePageRoutes(): string[] {
  return pageRoutesOf(
    JSON.parse(readFileSync(path.join(DIST, 'app-path-routes-manifest.json'), 'utf8')) as Record<
      string,
      string
    >,
  );
}

export interface DiscoveredPages {
  /** One concrete URL (path plus query) per dynamic route the console links to. */
  readonly found: ReadonlyMap<string, string>;
  /** The dynamic routes no link reached. */
  readonly missing: readonly string[];
}

/** How many pages of one dynamic route are read for further links (a first one may have none). */
const FAN_OUT = 8;

/**
 * Follows the console's links from every static page and from `seeds` (paths the console reaches
 * without a link, such as a bulk action's page after the action), with the session `request`
 * carries, to one concrete URL per dynamic route. Up to `FAN_OUT` pages of each dynamic route are
 * read for further links, so a nested page (a workflow's runs, a list's importers) is found even
 * when the first object of its kind has none.
 */
export async function discoverConsolePages(
  request: APIRequestContext,
  dashboardUrl: string,
  routes: readonly string[] = consolePageRoutes(),
  seeds: readonly string[] = [],
): Promise<DiscoveredPages> {
  const origin = new URL(dashboardUrl).origin;
  const found = new Map<string, string>();
  const readPerRoute = new Map<string, number>();
  const read = new Set<string>();
  const take = (link: string, into: string[]) => {
    const route = dynamicRouteOf(link.split('?')[0] ?? link, routes);
    if (route === null) {
      return;
    }
    if (!found.has(route)) {
      found.set(route, link);
    }
    const count = readPerRoute.get(route) ?? 0;
    if (count < FAN_OUT && !read.has(link) && !into.includes(link)) {
      readPerRoute.set(route, count + 1);
      into.push(link);
    }
  };
  let queue = routes.filter((route) => !isDynamicRoute(route) && !SIGNED_OUT_PAGES.includes(route));
  for (const seed of seeds) {
    take(seed, queue);
  }
  while (queue.length > 0) {
    const next: string[] = [];
    for (const target of queue) {
      if (read.has(target)) {
        continue;
      }
      read.add(target);
      const response = await request.get(`${dashboardUrl}${target}`, { maxRedirects: 0 });
      if (response.status() !== 200) {
        continue;
      }
      for (const link of linksOf(await response.text(), origin)) {
        take(link, next);
      }
    }
    queue = next;
  }
  return {
    found,
    missing: routes.filter((route) => isDynamicRoute(route) && !found.has(route)),
  };
}

/**
 * Makes, through the server API, the objects of the dynamic pages no other spec makes (an SLA
 * policy, a case queue with an assignment policy, a bulk action on one case), and answers the
 * paths the console reaches without a link (the bulk action's page). Synthetic names only.
 */
export async function makeSweepObjects(apiUrl: string, apiKey: string): Promise<string[]> {
  const { client } = recordingClient(apiUrl, apiKey);
  const suffix = randomUUID().slice(0, 8);
  await client.caseSlaPolicies.create({ name: `Sweep SLA ${suffix}`, 'target-minutes': 60 });
  const { data: queue } = await client.caseQueues.create({ name: `Sweep queue ${suffix}` });
  await client.caseAssignmentPolicies.create({
    name: `Sweep policy ${suffix}`,
    distribution: 'fewest-open',
    sources: [{ type: 'case-queue', id: queue.id }],
  });
  const { data: cases } = await client.cases.list();
  const first = cases[0];
  if (first === undefined) {
    return [];
  }
  const { data: bulk } = await client.cases.bulk({
    data: { attributes: { action: 'add-tags', 'case-ids': [first.id] } },
    meta: { 'tag-names': ['sweep'] },
  });
  return [`/cases/bulk/${bulk.id}`];
}

const memo = new Map<string, Promise<DiscoveredPages>>();

/**
 * The objects of `makeSweepObjects`, then `discoverConsolePages`, once per worker and dashboard,
 * signed in with the operator's `ovu_` token: the axe sweep and the CSP sweep share one walk.
 */
export function consolePagesOnce(
  newContext: (cookie: string) => Promise<APIRequestContext>,
  stack: Pick<StackInfo, 'apiUrl' | 'apiKey' | 'dashboardUrl'>,
  token: string,
): Promise<DiscoveredPages> {
  const known = memo.get(stack.dashboardUrl);
  if (known !== undefined) {
    return known;
  }
  const walk = (async () => {
    const seeds = await makeSweepObjects(stack.apiUrl, stack.apiKey);
    // KP11-78: the production build's session cookie is Secure, so `__Host-` prefixed.
    const request = await newContext(`__Host-openverify_session=${token}`);
    try {
      return await discoverConsolePages(request, stack.dashboardUrl, consolePageRoutes(), seeds);
    } finally {
      await request.dispose();
    }
  })();
  memo.set(stack.dashboardUrl, walk);
  return walk;
}
