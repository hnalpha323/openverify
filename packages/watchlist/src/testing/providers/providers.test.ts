import { describe, expect, it } from 'vitest';
import { seededRandom } from '../random.js';
import {
  GDELT_MAX_RECORDS,
  GDELT_SANDBOX_TOKEN,
  gdeltArticle,
  gdeltArtlistAnswer,
  gdeltCappedAnswer,
  gdeltEmptyAnswer,
  gdeltPlainTextErrorAnswer,
  gdeltRateLimitedAnswer,
  gdeltScenarioAnswer,
  type GdeltArticle,
} from './gdelt.js';
import {
  HIBP_SANDBOX_TOKEN,
  hibpBreach,
  hibpBreachedAccountAnswer,
  hibpNotFoundAnswer,
  hibpRateLimitedAnswer,
  hibpScenarioAnswer,
  hibpUnauthorizedAnswer,
} from './hibp.js';
import {
  smartyCandidate,
  smartyScenarioAnswer,
  smartyStreetAnswer,
  smartyUnauthorizedAnswer,
  type SmartyInput,
} from './smarty.js';
import { twilioErrorAnswer, twilioLookupAnswer, twilioScenarioAnswer } from './twilio-lookup.js';

const NOW = new Date(Date.UTC(2026, 9, 27, 12));
const json = (body: string): unknown => JSON.parse(body);
const articlesOf = (body: string): GdeltArticle[] =>
  (json(body) as { articles?: GdeltArticle[] }).articles ?? [];

describe('GDELT DOC 2.0 answers', () => {
  it('writes artlist records under .example domains naming the subject beside a term', () => {
    const article = gdeltArticle(seededRandom('gdelt'), {
      name: 'Avery Quillfeather',
      term: 'fraud',
      seen: NOW,
    });
    expect(article.title).toContain('Avery Quillfeather');
    expect(article.title.toLowerCase()).toContain('fraud');
    expect(article.title.length).toBeLessThanOrEqual(200);
    expect(article.domain).toMatch(/\.example$/);
    expect(new URL(article.url).hostname).toBe(article.domain);
    expect(article.seendate).toBe('20261027T120000Z');
    expect(Object.keys(article).sort()).toEqual(
      [
        'domain',
        'language',
        'seendate',
        'socialimage',
        'sourcecountry',
        'title',
        'url',
        'url_mobile',
      ].sort(),
    );
    const other = gdeltArticle(seededRandom('gdelt'), { name: null, term: 'fraud', seen: NOW });
    expect(other.title).not.toContain('Avery');
  });

  it('answers JSON lists, an empty object, the capped list, a 200 plain-text error and a 429', () => {
    const list = gdeltArtlistAnswer([]);
    expect(list).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    expect(json(list.body)).toEqual({ articles: [] });
    expect(json(gdeltEmptyAnswer().body)).toEqual({});
    const capped = gdeltCappedAnswer(seededRandom('cap'), {
      name: 'Rowan Fixturedale',
      term: 'fraud',
      seen: NOW,
      matching: false,
    });
    expect(articlesOf(capped.body)).toHaveLength(GDELT_MAX_RECORDS);
    expect(articlesOf(capped.body).some((a) => a.title.includes('Rowan Fixturedale'))).toBe(false);
    const matching = gdeltCappedAnswer(seededRandom('cap'), {
      name: 'Rowan Fixturedale',
      term: 'fraud',
      seen: NOW,
      matching: true,
    });
    expect(articlesOf(matching.body).every((a) => a.title.includes('Rowan Fixturedale'))).toBe(
      true,
    );
    const error = gdeltPlainTextErrorAnswer();
    expect(error.status).toBe(200);
    expect(error.headers['content-type']).toMatch(/^text\/plain/);
    expect(() => json(error.body)).toThrow();
    const limited = gdeltRateLimitedAnswer();
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toMatch(/^text\/plain/);
  });

  it('answers two articles for a phrase holding the sandbox token, none otherwise', () => {
    const hit = articlesOf(gdeltScenarioAnswer(`avery ${GDELT_SANDBOX_TOKEN}`, 'fraud', NOW).body);
    expect(hit).toHaveLength(2);
    expect(hit.every((a) => a.domain.endsWith('.example'))).toBe(true);
    expect(articlesOf(gdeltScenarioAnswer('avery quillfeather', 'fraud', NOW).body)).toEqual([]);
  });
});

describe('HIBP breachedaccount answers', () => {
  const breach = hibpBreach({ name: 'SyntheticForum', breachDate: '2026-07-01' });

  it('writes fictional breaches in the full model and the truncated one', () => {
    expect(breach).toMatchObject({
      Name: 'SyntheticForum',
      BreachDate: '2026-07-01',
      IsVerified: true,
    });
    expect(breach.Domain).toMatch(/\.example$/);
    expect(breach.DataClasses).toContain('Email addresses');
    const full = hibpBreachedAccountAnswer([breach], { truncate: false });
    expect(json(full.body)).toEqual([breach]);
    expect(json(hibpBreachedAccountAnswer([breach]).body)).toEqual([{ Name: 'SyntheticForum' }]);
  });

  it('answers 404, 401 and 429 with retry-after', () => {
    expect(hibpNotFoundAnswer()).toMatchObject({ status: 404, body: '' });
    expect(hibpUnauthorizedAnswer().status).toBe(401);
    const limited = hibpRateLimitedAnswer(7);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('7');
  });

  it('routes the sandbox token to a breach three months before now', () => {
    const hit = hibpScenarioAnswer(`${HIBP_SANDBOX_TOKEN}@mail.example`, NOW);
    expect(hit.status).toBe(200);
    expect((json(hit.body) as { BreachDate: string }[])[0]?.BreachDate).toBe('2026-07-27');
    expect(hibpScenarioAnswer('someone@mail.example', NOW).status).toBe(404);
  });
});

describe('Twilio Lookup v2 answers', () => {
  it('writes line type intelligence and SIM swap on the test network', () => {
    const answer = json(
      twilioLookupAnswer({
        phoneNumber: '+12025550101',
        lineType: 'nonFixedVoip',
        simSwap: { hoursAgo: 12 },
        now: NOW,
      }).body,
    ) as Record<string, Record<string, unknown> | string | boolean | null>;
    expect(answer).toMatchObject({
      phone_number: '+12025550101',
      country_code: 'US',
      calling_country_code: '1',
      valid: true,
    });
    expect(answer.line_type_intelligence).toMatchObject({
      type: 'nonFixedVoip',
      mobile_country_code: '001',
      mobile_network_code: '01',
      error_code: null,
    });
    expect(answer.sim_swap).toMatchObject({
      last_sim_swap: {
        last_sim_swap_date: '2026-10-27T00:00:00Z',
        swapped_period: 'PT12H',
        swapped_in_period: true,
      },
    });
    const plain = json(twilioLookupAnswer({ phoneNumber: '+12025550100' }).body) as Record<
      string,
      unknown
    >;
    expect(plain.line_type_intelligence).toBeNull();
    expect(plain.sim_swap).toBeNull();
  });

  it('writes Twilio’s error body', () => {
    const error = twilioErrorAnswer(401, 20003, 'Authenticate');
    expect(error.status).toBe(401);
    expect(json(error.body)).toMatchObject({ code: 20003, message: 'Authenticate', status: 401 });
  });

  it('routes NANP fictional numbers by their last two digits', () => {
    const type = (number: string) =>
      (
        json(twilioScenarioAnswer(number, NOW).body) as {
          line_type_intelligence: { type: string } | null;
        }
      ).line_type_intelligence?.type;
    expect(type('+12025550100')).toBe('mobile');
    expect(type('+12025550101')).toBe('nonFixedVoip');
    expect(type('+12025550106')).toBe('fixedVoip');
    const swap = json(twilioScenarioAnswer('+12025550103', NOW).body) as {
      sim_swap: { last_sim_swap: { swapped_in_period: boolean } };
    };
    expect(swap.sim_swap.last_sim_swap.swapped_in_period).toBe(true);
    expect(type('+12025550142')).toBe('unknown');
  });
});

describe('Smarty US Street answers', () => {
  const input = (house: number): SmartyInput => ({
    street: `${String(house)} Synthetic Ave`,
    city: 'Springfield',
    state: 'IL',
    zipcode: '62701',
  });
  const analysis = (house: number) => {
    const [candidate] = json(smartyScenarioAnswer(input(house)).body) as {
      analysis: Record<string, string>;
      metadata: Record<string, string>;
    }[];
    return candidate;
  };

  it('writes candidates echoing the components, with metadata and DPV analysis', () => {
    const candidate = smartyCandidate(input(1000));
    expect(candidate).toMatchObject({
      input_index: 0,
      candidate_index: 0,
      delivery_line_1: '1000 Synthetic Ave',
    });
    expect(candidate.components).toMatchObject({
      primary_number: '1000',
      city_name: 'Springfield',
      state_abbreviation: 'IL',
      zipcode: '62701',
    });
    expect(json(smartyStreetAnswer([candidate]).body)).toEqual([candidate]);
    expect(smartyUnauthorizedAnswer().status).toBe(401);
  });

  it('routes the sandbox house numbers 1000 to 1006, and anything else to no candidate', () => {
    expect(analysis(1000)?.analysis.dpv_match_code).toBe('Y');
    expect(analysis(1000)?.metadata.rdi).toBe('Residential');
    expect(analysis(1001)?.metadata.rdi).toBe('Commercial');
    expect(json(smartyScenarioAnswer(input(1002)).body)).toEqual([]);
    expect(analysis(1003)?.analysis.dpv_cmra).toBe('Y');
    expect(analysis(1004)?.analysis.dpv_vacant).toBe('Y');
    expect(analysis(1005)?.analysis.dpv_match_code).toBe('D');
    expect(analysis(1006)?.analysis.dpv_match_code).toBe('S');
    expect(json(smartyScenarioAnswer(input(42)).body)).toEqual([]);
  });
});
