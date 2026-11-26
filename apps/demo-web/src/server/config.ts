/**
 * The sample site's server configuration (plan C266.3), read from the environment only. The API
 * key and the webhook secret are never echoed: a problem names the variable, never its value.
 *
 * | Variable                          | Meaning                                                  |
 * | --------------------------------- | -------------------------------------------------------- |
 * | `OPENVERIFY_DEMO_API_URL`         | the API's base URL (`/api/v1` is added by the client)    |
 * | `OPENVERIFY_DEMO_API_KEY`         | a sandbox API key (a secret)                             |
 * | `OPENVERIFY_DEMO_WEBHOOK_SECRET`  | the webhook's signing secret (a secret)                  |
 * | `OPENVERIFY_DEMO_FLOW_URL`        | where the installation serves the flow                   |
 * | `OPENVERIFY_DEMO_TEMPLATE_ID`     | the inquiry template to create inquiries from            |
 * | `OPENVERIFY_DEMO_LISTEN`          | host:port, default 127.0.0.1:4180                        |
 * | `OPENVERIFY_DEMO_STATIC_DIR`      | the built page, default the app's `dist/`                |
 */
import { isAbsolute } from 'node:path';

export interface DemoConfig {
  readonly host: string;
  readonly port: number;
  /** The OpenVerify API's base URL (`/api/v1` is added by `@openverify/node`). */
  readonly apiUrl: string;
  /** A secret: sent only to the API, never logged, never sent to the browser. */
  readonly apiKey: string;
  /** A secret: the webhook's signing secret. */
  readonly webhookSecret: string;
  /** Where the installation serves the flow; the browser embeds it from there. */
  readonly flowUrl: string;
  readonly templateId: string;
  /** The built page (`vite build`). */
  readonly staticDir: string;
}

export const DEMO_DEFAULT_LISTEN = '127.0.0.1:4180';

export class DemoConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`the sample site cannot start:\n- ${problems.join('\n- ')}`);
    this.name = 'DemoConfigError';
    this.problems = problems;
  }
}

const TEMPLATE_ID = /^itmpl_[0-9A-HJKMNP-TV-Z]{26}$/;
const LISTEN = /^([^:\s]+):(\d{1,5})$/;

export function readDemoConfig(
  env: Readonly<Record<string, string | undefined>>,
  defaultStaticDir: string,
): DemoConfig {
  const problems: string[] = [];
  const url = (name: string): string => {
    const value = env[name] ?? '';
    let parsed: URL | undefined;
    try {
      parsed = new URL(value);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || !['http:', 'https:'].includes(parsed.protocol)) {
      problems.push(`${name} must be an http or https URL`);
      return '';
    }
    return value.replace(/\/+$/, '');
  };
  const secret = (name: string): string => {
    const value = env[name] ?? '';
    if (value === '') {
      problems.push(`${name} is required`);
    } else if (value.startsWith('change-me')) {
      problems.push(`${name} is still a change-me placeholder`);
    }
    return value;
  };

  const apiUrl = url('OPENVERIFY_DEMO_API_URL');
  const apiKey = secret('OPENVERIFY_DEMO_API_KEY');
  const webhookSecret = secret('OPENVERIFY_DEMO_WEBHOOK_SECRET');
  const flowUrl = url('OPENVERIFY_DEMO_FLOW_URL');
  const templateId = env.OPENVERIFY_DEMO_TEMPLATE_ID ?? '';
  if (!TEMPLATE_ID.test(templateId)) {
    problems.push('OPENVERIFY_DEMO_TEMPLATE_ID must be an inquiry template id (itmpl_...)');
  }
  const listen = LISTEN.exec(env.OPENVERIFY_DEMO_LISTEN ?? DEMO_DEFAULT_LISTEN);
  const port = Number(listen?.[2]);
  if (listen === null || port > 65_535) {
    problems.push('OPENVERIFY_DEMO_LISTEN must be host:port');
  }
  const staticDir = env.OPENVERIFY_DEMO_STATIC_DIR ?? defaultStaticDir;
  if (!isAbsolute(staticDir)) {
    problems.push('OPENVERIFY_DEMO_STATIC_DIR must be an absolute path');
  }
  if (problems.length > 0) {
    throw new DemoConfigError(problems);
  }
  return {
    host: listen?.[1] ?? '',
    port,
    apiUrl,
    apiKey,
    webhookSecret,
    flowUrl,
    templateId,
    staticDir,
  };
}
