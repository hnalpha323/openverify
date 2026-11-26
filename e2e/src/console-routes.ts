/**
 * The console's page routes for the console sweep (Workflow 9C, `integration-9c`; C170.3, C171.2):
 * read from the e2e build's route manifest, never listed by hand, and matched against the paths of
 * the console's own links. The sweep itself is `tests/support/console-pages.ts`.
 */

/** The pages a signed-out visitor opens; the sweep opens them without a session. */
export const SIGNED_OUT_PAGES: readonly string[] = ['/login', '/login/mfa', '/accept-invitation'];

/** Every page route of an app-path-routes manifest, the framework's `/_` routes left out, sorted. */
export function pageRoutesOf(manifest: Readonly<Record<string, string>>): string[] {
  return [
    ...new Set(
      Object.entries(manifest)
        .filter(([entry]) => entry.endsWith('/page'))
        .map(([, route]) => route)
        .filter((route) => !route.startsWith('/_')),
    ),
  ].sort();
}

/** Whether `route` has a dynamic segment (`[id]`). */
export const isDynamicRoute = (route: string): boolean => route.includes('[');

/** The pattern a concrete path of `route` matches: each `[segment]` is one path segment. */
export function routePattern(route: string): RegExp {
  const source = route
    .split('/')
    .map((segment) =>
      /^\[[^\]]+\]$/.test(segment) ? '[^/?#]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
}

/**
 * The dynamic route `pathname` is a page of, or null. A path that is itself a static route (for
 * example `/case-queues/policies` against `/case-queues/[id]`) is never taken for a dynamic one.
 */
export function dynamicRouteOf(pathname: string, routes: readonly string[]): string | null {
  if (routes.includes(pathname)) {
    return null;
  }
  return routes.filter(isDynamicRoute).find((route) => routePattern(route).test(pathname)) ?? null;
}

/** The same-origin links of a page's server HTML, as path plus query, in document order. */
export function linksOf(html: string, origin: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = (match[1] ?? '').replaceAll('&amp;', '&');
    if (href.startsWith('#')) {
      continue;
    }
    try {
      const url = new URL(href, origin);
      if (url.origin === origin) {
        links.push(`${url.pathname}${url.search}`);
      }
    } catch {
      // Not a URL: not a link the sweep follows.
    }
  }
  return links;
}
