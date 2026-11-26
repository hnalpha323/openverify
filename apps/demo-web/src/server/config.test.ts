// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEMO_DEFAULT_LISTEN, DemoConfigError, readDemoConfig } from './config.ts';

const ENV = {
  OPENVERIFY_DEMO_API_URL: 'http://127.0.0.1:3000',
  OPENVERIFY_DEMO_API_KEY: `ov_sbx_synthetic${'a'.repeat(32)}`,
  OPENVERIFY_DEMO_WEBHOOK_SECRET: `wbhsec_synthetic${'b'.repeat(32)}`,
  OPENVERIFY_DEMO_FLOW_URL: 'http://127.0.0.1:4173',
  OPENVERIFY_DEMO_TEMPLATE_ID: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
};

const problemsOf = (env: Record<string, string | undefined>): readonly string[] => {
  try {
    readDemoConfig(env, '/srv/demo');
  } catch (error) {
    if (error instanceof DemoConfigError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('expected a DemoConfigError');
};

describe('readDemoConfig', () => {
  it('reads every setting from the environment, with the default listen address', () => {
    expect(DEMO_DEFAULT_LISTEN).toBe('127.0.0.1:4180');
    expect(readDemoConfig(ENV, '/srv/demo')).toEqual({
      host: '127.0.0.1',
      port: 4180,
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: ENV.OPENVERIFY_DEMO_API_KEY,
      webhookSecret: ENV.OPENVERIFY_DEMO_WEBHOOK_SECRET,
      flowUrl: 'http://127.0.0.1:4173',
      templateId: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
      staticDir: '/srv/demo',
    });
  });

  it('takes a listen address, a static directory and trims a trailing slash off the URLs', () => {
    const config = readDemoConfig(
      {
        ...ENV,
        OPENVERIFY_DEMO_LISTEN: '0.0.0.0:8080',
        OPENVERIFY_DEMO_STATIC_DIR: '/var/www/demo',
        OPENVERIFY_DEMO_API_URL: 'https://api.example.com/',
        OPENVERIFY_DEMO_FLOW_URL: 'https://flow.example.com/',
      },
      '/srv/demo',
    );
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
      staticDir: '/var/www/demo',
      apiUrl: 'https://api.example.com',
      flowUrl: 'https://flow.example.com',
    });
  });

  it('names every missing or invalid setting and never echoes a secret', () => {
    const problems = problemsOf({
      OPENVERIFY_DEMO_API_URL: 'ftp://api.example.com',
      OPENVERIFY_DEMO_API_KEY: 'change-me-demo-key',
      OPENVERIFY_DEMO_FLOW_URL: 'not a url',
      OPENVERIFY_DEMO_TEMPLATE_ID: 'template-1',
      OPENVERIFY_DEMO_LISTEN: 'localhost',
      OPENVERIFY_DEMO_STATIC_DIR: 'relative/dir',
    });
    expect(problems).toEqual([
      'OPENVERIFY_DEMO_API_URL must be an http or https URL',
      'OPENVERIFY_DEMO_API_KEY is still a change-me placeholder',
      'OPENVERIFY_DEMO_WEBHOOK_SECRET is required',
      'OPENVERIFY_DEMO_FLOW_URL must be an http or https URL',
      'OPENVERIFY_DEMO_TEMPLATE_ID must be an inquiry template id (itmpl_...)',
      'OPENVERIFY_DEMO_LISTEN must be host:port',
      'OPENVERIFY_DEMO_STATIC_DIR must be an absolute path',
    ]);
    expect(problems.join(' ')).not.toContain('change-me-demo-key');
    expect(problemsOf({ ...ENV, OPENVERIFY_DEMO_LISTEN: '127.0.0.1:70000' })).toEqual([
      'OPENVERIFY_DEMO_LISTEN must be host:port',
    ]);
    expect(problemsOf({ ...ENV, OPENVERIFY_DEMO_API_KEY: '' })).toEqual([
      'OPENVERIFY_DEMO_API_KEY is required',
    ]);
  });
});
