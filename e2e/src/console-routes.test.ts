/**
 * The console sweep's routes (Workflow 9C, `integration-9c`): every page of the build's manifest,
 * the dynamic ones matched one segment per `[segment]`, and a static route never taken for a
 * dynamic one; links read from the server HTML, same origin only.
 */
import { describe, expect, it } from 'vitest';
import {
  SIGNED_OUT_PAGES,
  dynamicRouteOf,
  isDynamicRoute,
  linksOf,
  pageRoutesOf,
  routePattern,
} from './console-routes.js';

const MANIFEST = {
  '/page': '/',
  '/_global-error/page': '/_global-error',
  '/case-queues/page': '/case-queues',
  '/case-queues/[id]/page': '/case-queues/[id]',
  '/case-queues/policies/page': '/case-queues/policies',
  '/case-queues/policies/[id]/page': '/case-queues/policies/[id]',
  '/templates/[id]/versions/[versionId]/page': '/templates/[id]/versions/[versionId]',
  '/csp-reports/route': '/csp-reports',
  '/login/page': '/login',
};

describe('the console page routes (C170.3, C171.2)', () => {
  it('keeps every page of the manifest, sorted, without route handlers or framework routes', () => {
    expect(pageRoutesOf(MANIFEST)).toEqual([
      '/',
      '/case-queues',
      '/case-queues/[id]',
      '/case-queues/policies',
      '/case-queues/policies/[id]',
      '/login',
      '/templates/[id]/versions/[versionId]',
    ]);
  });

  it('tells dynamic routes apart and matches one path segment per dynamic segment', () => {
    expect(isDynamicRoute('/cases/[id]')).toBe(true);
    expect(isDynamicRoute('/cases')).toBe(false);
    const pattern = routePattern('/templates/[id]/versions/[versionId]');
    expect(pattern.test('/templates/itmpl_1/versions/itmplv_2')).toBe(true);
    expect(pattern.test('/templates/itmpl_1/versions')).toBe(false);
    expect(pattern.test('/templates/itmpl_1/x/versions/itmplv_2')).toBe(false);
    expect(routePattern('/a.b/[id]').test('/aXb/1')).toBe(false);
  });

  it('never takes a static route for a dynamic one', () => {
    const routes = pageRoutesOf(MANIFEST);
    expect(dynamicRouteOf('/case-queues/policies', routes)).toBeNull();
    expect(dynamicRouteOf('/case-queues/cq_1', routes)).toBe('/case-queues/[id]');
    expect(dynamicRouteOf('/case-queues/policies/cqp_1', routes)).toBe(
      '/case-queues/policies/[id]',
    );
    expect(dynamicRouteOf('/nowhere/1', routes)).toBeNull();
  });

  it('reads same-origin links in order, with their query, decoded, and nothing else', () => {
    const html = [
      '<a class="x" href="/cases/cas_1?tab=a&amp;b=c">one</a>',
      '<a href="https://elsewhere.example/cases/cas_2">two</a>',
      '<a href="#main">skip</a>',
      '<a href="http://127.0.0.1:3000/inquiries/inq_1">three</a>',
      '<link href="/styles.css">',
      '<a href="http://[bad">bad</a>',
    ].join('');
    expect(linksOf(html, 'http://127.0.0.1:3000')).toEqual([
      '/cases/cas_1?tab=a&b=c',
      '/inquiries/inq_1',
    ]);
  });

  it('names the signed-out pages', () => {
    expect(SIGNED_OUT_PAGES).toEqual(['/login', '/login/mfa', '/accept-invitation']);
  });
});
