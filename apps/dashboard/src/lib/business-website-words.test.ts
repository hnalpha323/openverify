// @vitest-environment node
/**
 * C61.3–C61.5, C66: the business website vocabulary in words. The resolution routes and the
 * reasons an age is unavailable are read from the evaluators' own source
 * (`packages/checks/src/business`), so one added there without words here fails this test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import {
  BUSINESS_WEBSITE_PASS_MEANING,
  domainAgeFlagText,
  resolutionRouteText,
} from './business-website-words';

const source = (file: string) =>
  readFileSync(
    new URL(`../../../../packages/checks/src/business/${file}`, import.meta.url),
    'utf8',
  );
const literals = (text: string) =>
  [...text.matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);

/**
 * The routes `business_website_resolution_detection` records (`route: …`): kebab-case literals,
 * so a compared answer kind (`answer.kind === 'not_found' ? …`) is left out.
 */
const ROUTES = [
  ...new Set(
    [...source('business-website-resolution-detection.ts').matchAll(/route: ([^,}]*)/g)]
      .flatMap((match) => literals(match[1] ?? ''))
      .filter((literal) => /^[a-z-]+$/.test(literal)),
  ),
];

/**
 * The flags of an unavailable age: each unavailable reason of the domain age port, kebab-cased
 * as the evaluator writes it, and the evaluator's own `future-date`.
 */
const AGE_SOURCE = source('business-website-domain-age-detection.ts');
const AGE_FLAGS = [
  ...literals(/readonly reason: ([^;]*);/.exec(source('inputs.ts'))?.[1] ?? '').map((reason) =>
    reason.replaceAll('_', '-'),
  ),
  ...literals(/flags: \[('future-date')\]/.exec(AGE_SOURCE)?.[1] ?? ''),
];

const WORDS = /^[A-Z][^_]{1,79}$/;
const SENTENCE = /^[A-Z][^_]+\.$/;

describe('the business website vocabulary in words (C61.3–C61.5, C66)', () => {
  it('reads the resolution routes and the unavailable-age flags from the evaluators', () => {
    expect(ROUTES).toEqual(['reserved', 'nxdomain', 'no-address', 'dns']);
    expect(AGE_SOURCE).toContain("answer.reason.replaceAll('_', '-')");
    expect(AGE_FLAGS).toEqual([
      'no-rdap-service',
      'not-found',
      'subdomain',
      'no-registration-date',
      'future-date',
    ]);
  });

  it.each(ROUTES)('says the route %s', (route) => {
    expect(resolutionRouteText(route)?.words).toMatch(WORDS);
  });

  it('says a reserved name in a sandbox is answered without a DNS query', () => {
    expect(resolutionRouteText('reserved')?.explanation).toMatch(/sandbox.*without a DNS query/);
  });

  it.each(AGE_FLAGS)('says the flag %s', (flag) => {
    expect(domainAgeFlagText(flag)?.words).toMatch(WORDS);
    const explanation = domainAgeFlagText(flag)?.explanation;
    if (explanation !== undefined) {
      expect(explanation).toMatch(SENTENCE);
    }
  });

  it('says a subdomain is not aged by its platform (C61.4)', () => {
    expect(domainAgeFlagText('subdomain')?.explanation).toMatch(/platform/);
  });

  it.each(['dns-ish', 'constructor'])('knows nothing of %s', (value) => {
    expect(resolutionRouteText(value)).toBeUndefined();
    expect(domainAgeFlagText(value)).toBeUndefined();
  });

  it('says what a pass means as `docs/checks/business.md` says it, sentence by sentence', () => {
    const section = passMeansSection('business.md').replaceAll('`', '').toLowerCase();
    const sentences = sentencesOf(BUSINESS_WEBSITE_PASS_MEANING);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(section, sentence).toContain(sentence.toLowerCase());
    }
    expect(BUSINESS_WEBSITE_PASS_MEANING).toMatch(
      /^The website's host resolves to a public internet address/,
    );
    expect(BUSINESS_WEBSITE_PASS_MEANING).toMatch(/who runs the site/);
  });
});
