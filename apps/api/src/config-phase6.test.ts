/**
 * Phase 6 settings (C72.5, C76, C80, C81, C83), each read and validated by the process that uses
 * it (C63, V10): the report limits by the API and the worker; the list sync settings, the EU token,
 * the Wikidata contact and the PEP rules by the worker (and the CLIs, which read as the worker); a
 * report provider's credentials by the worker, only while its kind is bound to it. Every problem
 * names the variable and never echoes its value. Every value here is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type LoadConfigOptions } from './config.js';
import { syntheticEnv } from './test-support/env.js';

function issuesOf(env: NodeJS.ProcessEnv, options: LoadConfigOptions = {}): readonly string[] {
  try {
    loadConfig(syntheticEnv(env), options);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

const WORKER = { process: 'worker' } as const;
const PRODUCTION = { OPENVERIFY_MODE: 'production' };

describe('the report limits (C72.5, P09, V09)', () => {
  it('take the plan’s provisional defaults in both processes', () => {
    for (const process of ['api', 'worker'] as const) {
      expect(loadConfig(syntheticEnv(), { process }).reports).toEqual({
        perMinute: 600,
        maxRecurringPerEnvironment: 250_000,
        maxMediaRunsPerDay: 8_640,
      });
    }
  });

  it('are read by both processes', () => {
    const env = syntheticEnv({
      OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE: '120',
      OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT: '1000',
      OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY: '17280',
    });

    for (const process of ['api', 'worker'] as const) {
      expect(loadConfig(env, { process }).reports).toEqual({
        perMinute: 120,
        maxRecurringPerEnvironment: 1000,
        maxMediaRunsPerDay: 17_280,
      });
    }
  });

  it.each([
    ['OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE', 1_000_000],
    ['OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT', 10_000_000],
    // At most the whole GDELT install budget a day (17,280 requests, C81.2).
    ['OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY', 17_280],
  ])('refuse %s outside 1 to its maximum', (name, max) => {
    for (const value of ['0', '-5', '1.5', 'lots', String(max + 1)]) {
      expect(issuesOf({ [name]: value }), value).toEqual([
        `${name}: must be a whole number from 1 to ${String(max)}`,
      ]);
    }
  });
});

describe('the list sync settings (C76, C80), in the worker only', () => {
  it('take their defaults: no refresh tick, no EU token or Wikidata contact', () => {
    expect(loadConfig(syntheticEnv(), WORKER).watchlists).toEqual({
      sourcesDisabled: [],
      refresh: false,
      removedRetentionDays: 90,
      euFsfToken: null,
      wikidataUserAgent: null,
      wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
      pep: {
        openTenureMaxYears: 20,
        includeRelatives: false,
        retentionMonths: 12,
        headRetentionMonths: 60,
      },
    });
  });

  it('are read by the worker', () => {
    const config = loadConfig(
      syntheticEnv({
        OPENVERIFY_WATCHLIST_REFRESH: 'true',
        OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS: '30',
        OPENVERIFY_EU_FSF_TOKEN: 'synthetic-eu-fsf-token',
        OPENVERIFY_WIKIDATA_USER_AGENT: ' ExampleScreening/1.0 (ops@example.test) ',
        OPENVERIFY_WIKIDATA_SPARQL_URL: 'https://sparql.example.test/sparql',
        OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS: '10',
        OPENVERIFY_PEP_INCLUDE_RELATIVES: 'TRUE',
        OPENVERIFY_PEP_RETENTION_MONTHS: '24',
        OPENVERIFY_PEP_HEAD_RETENTION_MONTHS: '120',
      }),
      WORKER,
    );

    expect(config.watchlists).toEqual({
      sourcesDisabled: [],
      refresh: true,
      removedRetentionDays: 30,
      euFsfToken: 'synthetic-eu-fsf-token',
      wikidataUserAgent: 'ExampleScreening/1.0 (ops@example.test)',
      wikidataSparqlUrl: 'https://sparql.example.test/sparql',
      pep: {
        openTenureMaxYears: 10,
        includeRelatives: true,
        retentionMonths: 24,
        headRetentionMonths: 120,
      },
    });
  });

  it('are neither read nor checked by the API, which never holds the EU token', () => {
    const config = loadConfig(
      syntheticEnv({
        OPENVERIFY_WATCHLIST_REFRESH: 'daily',
        OPENVERIFY_EU_FSF_TOKEN: 'synthetic-eu-fsf-token',
        OPENVERIFY_WIKIDATA_SPARQL_URL: 'not a url',
      }),
    );

    expect(config.watchlists.refresh).toBe(false);
    expect(config.watchlists.euFsfToken).toBeNull();
    expect(config.watchlists.wikidataSparqlUrl).toBe('https://query.wikidata.org/sparql');
  });

  it('are refused by the worker when malformed, naming each variable and echoing no value', () => {
    const issues = issuesOf(
      {
        OPENVERIFY_WATCHLIST_REFRESH: 'daily',
        OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS: '0',
        OPENVERIFY_EU_FSF_TOKEN: 'secret with spaces',
        OPENVERIFY_WIKIDATA_USER_AGENT: 'secret',
        OPENVERIFY_WIKIDATA_SPARQL_URL: 'http://sparql.example.test/secret',
        OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS: '101',
        OPENVERIFY_PEP_INCLUDE_RELATIVES: 'maybe',
        OPENVERIFY_PEP_RETENTION_MONTHS: '0',
        OPENVERIFY_PEP_HEAD_RETENTION_MONTHS: '601',
      },
      WORKER,
    );

    expect(issues).toEqual([
      'OPENVERIFY_WATCHLIST_REFRESH: must be true or false',
      'OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS: must be a whole number from 1 to 3650',
      'OPENVERIFY_EU_FSF_TOKEN: must be 8-512 printable characters without spaces',
      'OPENVERIFY_WIKIDATA_USER_AGENT: must be a User-Agent with your contact, 8-300 printable characters',
      'OPENVERIFY_WIKIDATA_SPARQL_URL: must be an https URL',
      'OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS: must be a whole number from 1 to 100',
      'OPENVERIFY_PEP_INCLUDE_RELATIVES: must be true or false',
      'OPENVERIFY_PEP_RETENTION_MONTHS: must be a whole number from 1 to 600',
      'OPENVERIFY_PEP_HEAD_RETENTION_MONTHS: must be a whole number from 1 to 600',
    ]);
    expect(issues.join('\n')).not.toContain('secret');
  });

  it('refuse a change-me EU token in production (decision 11: the operator sets a real one)', () => {
    expect(
      issuesOf({ ...PRODUCTION, OPENVERIFY_EU_FSF_TOKEN: 'change-me-eu-fsf-token' }, WORKER),
    ).toEqual(['OPENVERIFY_EU_FSF_TOKEN: still holds a change-me placeholder; set a real secret']);
  });
});

/** Synthetic, well-formed, low-entropy credentials: never real. */
const LOOKUP = {
  OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID: `AC${'d'.repeat(32)}`,
  OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID: `SK${'e'.repeat(32)}`,
  OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET: 'l'.repeat(32),
};
const SMARTY = {
  OPENVERIFY_SMARTY_AUTH_ID: 'synthetic-smarty-auth-id',
  OPENVERIFY_SMARTY_AUTH_TOKEN: 't'.repeat(24),
};
const HIBP = { OPENVERIFY_HIBP_API_KEY: 'h'.repeat(32) };

describe('the report providers’ credentials (C83), in the worker only', () => {
  it('stop the worker binding gdelt-doc without the disclosure acknowledgement (decision 7)', () => {
    const binding = { OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'gdelt-doc' };
    const refusal = [
      'OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: must be true to bind adverseMedia to gdelt-doc, ' +
        'which sends every screened name to GDELT (decision 7)',
    ];

    expect(issuesOf(binding, WORKER)).toEqual(refusal);
    expect(
      issuesOf({ ...binding, OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'false' }, WORKER),
    ).toEqual(refusal);
    const acknowledged = loadConfig(
      syntheticEnv({ ...binding, OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'true' }),
      WORKER,
    );
    expect(acknowledged.providers.production).toMatchObject({ adverseMedia: 'gdelt-doc' });
    expect(acknowledged.reportProviders.gdeltAcknowledged).toBe(true);
  });

  it('need no acknowledgement for the sandbox media provider, which sends nothing', () => {
    const config = loadConfig(
      syntheticEnv({ OPENVERIFY_PROVIDER_ADVERSE_MEDIA_SANDBOX: 'sandbox' }),
      WORKER,
    );

    expect(config.providers.sandbox).toMatchObject({ adverseMedia: 'sandbox' });
    expect(config.reportProviders.gdeltAcknowledged).toBe(false);
  });

  it('are read while their kind is bound to their adapter', () => {
    const config = loadConfig(
      syntheticEnv({
        OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
        OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_SANDBOX: 'twilio-lookup',
        OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_PRODUCTION: 'smarty',
        ...HIBP,
        ...LOOKUP,
        ...SMARTY,
      }),
      WORKER,
    );

    expect(config.reportProviders).toEqual({
      gdeltAcknowledged: false,
      hibp: { apiKey: HIBP.OPENVERIFY_HIBP_API_KEY },
      twilioLookup: {
        accountSid: LOOKUP.OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID,
        apiKeySid: LOOKUP.OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID,
        apiKeySecret: LOOKUP.OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET,
      },
      smarty: {
        authId: SMARTY.OPENVERIFY_SMARTY_AUTH_ID,
        authToken: SMARTY.OPENVERIFY_SMARTY_AUTH_TOKEN,
      },
    });
  });

  it('stop the worker naming each missing credential of a bound adapter', () => {
    expect(
      issuesOf(
        {
          OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
          OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION: 'twilio-lookup',
          OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_PRODUCTION: 'smarty',
          // The API's SMS credentials are not the Lookup adapter's (decision 32).
          OPENVERIFY_TWILIO_ACCOUNT_SID: LOOKUP.OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID,
        },
        WORKER,
      ),
    ).toEqual([
      'OPENVERIFY_HIBP_API_KEY: is required while emailIntelligence is bound to hibp',
      'OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID: is required while phoneIntelligence is bound to twilio-lookup',
      'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID: is required while phoneIntelligence is bound to twilio-lookup',
      'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET: is required while phoneIntelligence is bound to twilio-lookup',
      'OPENVERIFY_SMARTY_AUTH_ID: is required while addressVerification is bound to smarty',
      'OPENVERIFY_SMARTY_AUTH_TOKEN: is required while addressVerification is bound to smarty',
    ]);
  });

  it('are read by neither process otherwise, so the API never holds them', () => {
    const env = { ...HIBP, ...LOOKUP, ...SMARTY, OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'true' };
    const unbound = loadConfig(syntheticEnv(env), WORKER).reportProviders;
    const api = loadConfig(
      syntheticEnv({
        ...env,
        OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
        OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'gdelt-doc',
        OPENVERIFY_HIBP_API_KEY: 'not a key',
      }),
    ).reportProviders;

    expect(unbound).toEqual({
      gdeltAcknowledged: true,
      hibp: null,
      twilioLookup: null,
      smarty: null,
    });
    expect(api).toEqual({ gdeltAcknowledged: false, hibp: null, twilioLookup: null, smarty: null });
  });

  it('are refused when malformed without echoing them, and as change-me placeholders in production', () => {
    const issues = issuesOf(
      {
        OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
        OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION: 'twilio-lookup',
        OPENVERIFY_HIBP_API_KEY: 'secret',
        ...LOOKUP,
        OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID: 'ACsecret',
        OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'yes',
      },
      WORKER,
    );
    expect(issues).toEqual([
      'OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: must be true or false',
      'OPENVERIFY_HIBP_API_KEY: must be 8-512 printable characters without spaces',
      'OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID: must be a Twilio account SID (AC and 32 hex characters)',
    ]);
    expect(issues.join('\n')).not.toContain('secret');

    expect(
      issuesOf(
        {
          ...PRODUCTION,
          OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
          OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION: 'twilio-lookup',
          OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_PRODUCTION: 'smarty',
          ...LOOKUP,
          ...SMARTY,
          OPENVERIFY_HIBP_API_KEY: 'change-me-hibp-api-key',
          OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET: 'change-me-twilio-lookup-api-key-secret',
          OPENVERIFY_SMARTY_AUTH_TOKEN: 'change-me-smarty-auth-token',
        },
        WORKER,
      ),
    ).toEqual([
      'OPENVERIFY_HIBP_API_KEY: still holds a change-me placeholder; set a real secret',
      'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET: still holds a change-me placeholder; set a real secret',
      'OPENVERIFY_SMARTY_AUTH_TOKEN: still holds a change-me placeholder; set a real secret',
    ]);
  });
});
