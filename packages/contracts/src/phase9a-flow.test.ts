/**
 * Workflow 9A Stage 1a, (F): the flow API amendments (C151.5-C151.8, C148.5, C153.2, C158.4-C158.5,
 * C160.6, C162.9, C171.4), the `OpenVerify-Flow-Spec` header, the internal embed policy, the
 * settings of C158.1, the preview and embed messages (C156.2, C159.4), and the import-free origin
 * module with its golden vectors (C157.2, C158.1; verification round V04).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DASHBOARD_SETTINGS_DEFAULTS,
  EMBEDDING_SETTINGS_DEFAULTS,
  dashboardSettingsSchema,
  dashboardUpdateSettingsBodySchema,
} from './dashboard-api.js';
import {
  FLOW_SPEC_HEADER,
  PII_FLOW_SCREEN_ATTRIBUTES,
  embedPolicyAnswerSchema,
  extendSelfieCaptureParamsSchema,
  flowThemeAssetParamsSchema,
  parseFlowSpecHeader,
  submitFlowScreenBodySchema,
} from './flow-embed.js';
import {
  flowConsentBodySchema,
  flowFileUploadFieldsSchema,
  flowSessionResponseSchema,
} from './flow-api.js';
import {
  EMBED_ERROR_CODES,
  FLOW_MESSAGE_MAX_BYTES,
  PREVIEW_ASSETS_MAX_BYTES,
  consoleToPreviewMessageSchema,
  flowToParentMessageSchema,
  parentToFlowMessageSchema,
  previewToConsoleMessageSchema,
} from './flow-messages.js';
import { createInquiryBodySchema } from './inquiries.js';
import {
  checkOriginEntry,
  matchesOriginPattern,
  parseEmbedPolicyAnswer,
  type OriginEnvironmentKind,
} from './origin-pattern.js';
import { readFixture } from './test-support.js';

interface Vectors {
  matches: { origin: string; entry: string; expected: boolean }[];
  entries: { entry: string; environment: OriginEnvironmentKind; refusal: string | null }[];
  answers: { answer: unknown; valid: boolean }[];
}
const vectors = readFixture('origin-pattern/vectors.json') as Vectors;
type Json = Record<string, unknown>;

describe('the origin module (C158.1, V04)', () => {
  it.each(vectors.matches.map((vector) => [vector.origin, vector.entry, vector.expected] as const))(
    'matchesOriginPattern(%j, %j) is %s',
    (origin, entry, expected) => {
      expect(matchesOriginPattern(origin, entry)).toBe(expected);
    },
  );

  it.each(
    vectors.entries.map((vector) => [vector.entry, vector.environment, vector.refusal] as const),
  )('the entry %j in %s is refused for %j', (entry, environment, refusal) => {
    expect(checkOriginEntry(entry, environment)).toBe(refusal);
  });

  it.each(vectors.answers.map((vector, index) => [index, vector.answer, vector.valid] as const))(
    'parseEmbedPolicyAnswer and the zod schema agree on answer %i',
    (_index, answer, valid) => {
      expect(parseEmbedPolicyAnswer(answer) !== null).toBe(valid);
      expect((embedPolicyAnswerSchema as z.ZodType).safeParse(answer).success).toBe(valid);
    },
  );

  it('reads a valid answer into its members', () => {
    const answer = vectors.answers[0]?.answer as Json;
    expect(parseEmbedPolicyAnswer(answer)).toEqual({
      inquiryId: answer['inquiry-id'],
      templateId: answer['template-id'],
      environmentId: answer['environment-id'],
      frameAncestors: answer['frame-ancestors'],
    });
  });

  it('imports nothing, so the flow server runs it from source (V04)', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'origin-pattern.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*(?:import|export\s+\*|export\s+\{[^}]*\}\s+from)\b/m);
  });

  it('is the package subpath @openverify/contracts/origin-pattern, from source under its condition', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { exports: Record<string, Record<string, string>> };
    expect(manifest.exports['./origin-pattern']).toEqual({
      '@openverify/source': './src/origin-pattern.ts',
      types: './dist/origin-pattern.d.ts',
      default: './dist/origin-pattern.js',
    });
  });
});

describe('the OpenVerify-Flow-Spec header (C151.7)', () => {
  it('lists the versions a client renders; absent means 1, unknown values are ignored', () => {
    expect(FLOW_SPEC_HEADER).toBe('OpenVerify-Flow-Spec');
    expect(parseFlowSpecHeader(undefined)).toEqual([1]);
    expect(parseFlowSpecHeader('1, 2')).toEqual([1, 2]);
    expect(parseFlowSpecHeader('2,9,x')).toEqual([2]);
    expect(parseFlowSpecHeader('x')).toEqual([1]);
  });
});

describe('the session (C151.5-C151.8)', () => {
  it('serves a client that declared only spec 1 the projection, and no step', () => {
    const doc = readFixture('api/flow-session-v1-projection.json') as Json;
    expect(flowSessionResponseSchema.parse(doc)).toEqual(doc);
    expect(doc.step).toBeUndefined();
    expect(doc['spec-version']).toBe(1);
    expect((doc.flow as Json).transitions).toEqual([]);
  });

  it('serves a spec-2 client the step, its values, the theme, copy, locales, embed and completion', () => {
    const doc = readFixture('api/flow-session-v2.json') as Json;
    expect(flowSessionResponseSchema.parse(doc)).toEqual(doc);
    expect(doc).toMatchObject({
      'spec-version': 2,
      position: { 'step-id': 'extra_details', state: 'active' },
      step: { type: 'screen' },
      values: { nickname: 'Sam', tax_number: { set: true } },
      locales: { enabled: ['en', 'es'], default: 'en' },
    });
  });

  it('never carries a step name, a branch or an action in the step', () => {
    const doc = structuredClone(readFixture('api/flow-session-v2.json')) as Json;
    (doc.step as Json).name = 'Extra details';
    expect(flowSessionResponseSchema.safeParse(doc).success).toBe(false);
    doc.step = { id: 'age_route', type: 'branch', routes: [] };
    expect(flowSessionResponseSchema.safeParse(doc).success).toBe(false);
  });

  it('carries a redirect URL only in completion', () => {
    const doc = structuredClone(readFixture('api/flow-session-v2.json')) as Json;
    doc.completion = { 'redirect-url': 'javascript:alert(1)' };
    expect(flowSessionResponseSchema.safeParse(doc).success).toBe(false);
  });
});

describe('the flow routes (C148.5, C153.2, C162.9, C171.4, C160.6)', () => {
  it('submits a screen with its values and a button key, nothing else', () => {
    expect(
      submitFlowScreenBodySchema.safeParse({ values: { nickname: 'Sam' }, button: 'later' })
        .success,
    ).toBe(true);
    expect(submitFlowScreenBodySchema.safeParse({ values: {} }).success).toBe(true);
    expect(submitFlowScreenBodySchema.safeParse({ values: {}, port: 'route:minor' }).success).toBe(
      false,
    );
    expect(PII_FLOW_SCREEN_ATTRIBUTES).toEqual(['values']);
  });

  it('records the digests of the consent texts as shown, their source and the catalog (C162.9)', () => {
    const body = {
      accepted: true,
      'text-keys': ['consent.biometric'],
      locale: 'en',
      'text-sha256': ['a'.repeat(64)],
      'copy-source': 'built-in',
      'catalog-version': '2026.11.1',
    };
    expect(flowConsentBodySchema.safeParse(body).success).toBe(true);
    expect(flowConsentBodySchema.safeParse({ ...body, 'text-sha256': ['xyz'] }).success).toBe(
      false,
    );
    expect(flowConsentBodySchema.safeParse({ ...body, 'copy-source': 'operator' }).success).toBe(
      false,
    );
  });

  it('takes the client-reported capture method of an upload (C153.2)', () => {
    expect(
      flowFileUploadFieldsSchema.safeParse({ kind: 'front', 'capture-method': 'camera' }).success,
    ).toBe(true);
    expect(
      flowFileUploadFieldsSchema.safeParse({ kind: 'front', 'capture-method': 'scanner' }).success,
    ).toBe(false);
  });

  it('names a selfie capture to extend and a theme asset by their ids', () => {
    expect(
      extendSelfieCaptureParamsSchema.safeParse({ id: 'self_01M5CJXHG07XPHF3HRM6NREDH9' }).success,
    ).toBe(true);
    expect(
      flowThemeAssetParamsSchema.safeParse({ id: 'tsa_01M5CN00000000000000009A10' }).success,
    ).toBe(true);
    expect(flowThemeAssetParamsSchema.safeParse({ id: '../../etc/passwd' }).success).toBe(false);
  });

  it('takes a redirect URI on a new inquiry (C158.4)', () => {
    const body = (uri: string) => ({
      data: {
        attributes: {
          'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
          'redirect-uri': uri,
        },
      },
    });
    expect(createInquiryBodySchema.safeParse(body('https://shop.example.com/done')).success).toBe(
      true,
    );
    expect(createInquiryBodySchema.safeParse(body('https://u:p@shop.example.com/')).success).toBe(
      false,
    );
  });
});

describe('the embedding settings (C158.1, C174.6)', () => {
  it('serves the allowed origins and the default theme set', () => {
    const settings = dashboardSettingsSchema.safeParse({
      'require-mfa': false,
      'inquiry-retention-days': null,
      'api-log-retention-days': 30,
      'webhook-delivery-retention-days': 30,
      'event-retention-days': 90,
      'allowed-embed-origins': ['https://shop.example.com'],
      'allowed-redirect-origins': null,
      'default-theme-set-id': null,
    });
    expect(settings.success).toBe(true);
  });

  it('defaults to no embedding, the install-wide redirect rule and no theme set, the origins served since Stage 1b (F)', () => {
    expect(EMBEDDING_SETTINGS_DEFAULTS).toEqual({
      'allowed-embed-origins': [],
      'allowed-redirect-origins': null,
      'default-theme-set-id': null,
    });
    // Workflow 9A Stage 1b serves them, the two origin settings at (F) and the default theme set
    // at (H), so their defaults are the served ones.
    expect(DASHBOARD_SETTINGS_DEFAULTS).toMatchObject(EMBEDDING_SETTINGS_DEFAULTS);
    expect(
      dashboardSettingsSchema.safeParse({
        ...DASHBOARD_SETTINGS_DEFAULTS,
        ...EMBEDDING_SETTINGS_DEFAULTS,
      }).success,
    ).toBe(true);
  });

  it('takes a wildcard acknowledgement beside the origins (V17)', () => {
    expect(
      dashboardUpdateSettingsBodySchema.safeParse({
        'allowed-embed-origins': ['https://*.example.com'],
        meta: { 'acknowledge-wildcards': true },
      }).success,
    ).toBe(true);
    expect(
      dashboardUpdateSettingsBodySchema.safeParse({ meta: { 'acknowledge-wildcards': true } })
        .success,
    ).toBe(false);
  });
});

describe('the messages (C156.2, C159.4)', () => {
  it('caps a message at 1 MiB and the preview assets at 1 MiB in all', () => {
    expect(FLOW_MESSAGE_MAX_BYTES).toBe(1024 * 1024);
    expect(PREVIEW_ASSETS_MAX_BYTES).toBe(1024 * 1024);
  });

  it('takes the console messages to the preview, versioned, and nothing else', () => {
    const message = (type: string, more: Json = {}) => ({
      source: 'openverify-console',
      version: 1,
      type,
      ...more,
    });
    expect(
      consoleToPreviewMessageSchema.safeParse(message('select-step', { 'step-id': 'consent' }))
        .success,
    ).toBe(true);
    expect(
      consoleToPreviewMessageSchema.safeParse(message('set-viewport', { width: 320 })).success,
    ).toBe(true);
    expect(
      consoleToPreviewMessageSchema.safeParse(message('set-scheme', { scheme: 'dark' })).success,
    ).toBe(true);
    expect(
      consoleToPreviewMessageSchema.safeParse(
        message('preview-assets', {
          assets: [
            {
              'asset-id': 'tsa_01M5CN00000000000000009A10',
              kind: 'logo',
              bytes: new ArrayBuffer(8),
            },
          ],
        }),
      ).success,
    ).toBe(true);
    expect(
      consoleToPreviewMessageSchema.safeParse({
        ...message('select-step', { 'step-id': 'consent' }),
        version: 2,
      }).success,
    ).toBe(false);
    expect(
      consoleToPreviewMessageSchema.safeParse(message('eval', { code: 'alert(1)' })).success,
    ).toBe(false);
  });

  it('takes the preview answers to the console', () => {
    expect(
      previewToConsoleMessageSchema.safeParse({
        source: 'openverify-preview',
        version: 1,
        type: 'ready',
      }).success,
    ).toBe(true);
    expect(
      previewToConsoleMessageSchema.safeParse({
        source: 'openverify-preview',
        version: 1,
        type: 'navigated',
        'step-id': 'consent',
      }).success,
    ).toBe(true);
  });

  it('takes the parent hello, and the flow messages with no PII, token or step id', () => {
    expect(
      parentToFlowMessageSchema.safeParse({
        source: 'openverify-parent',
        version: 1,
        type: 'hello',
      }).success,
    ).toBe(true);
    const flow = (more: Json) => ({ source: 'openverify-flow', version: 1, ...more });
    expect(flowToParentMessageSchema.safeParse(flow({ type: 'ready' })).success).toBe(true);
    expect(flowToParentMessageSchema.safeParse(flow({ type: 'resize', height: 640 })).success).toBe(
      true,
    );
    expect(
      flowToParentMessageSchema.safeParse(
        flow({ type: 'event', name: 'step-changed', metadata: { 'step-type': 'screen' } }),
      ).success,
    ).toBe(true);
    expect(
      flowToParentMessageSchema.safeParse(
        flow({ type: 'event', name: 'step-changed', metadata: { 'step-id': 'consent' } }),
      ).success,
    ).toBe(false);
    expect(
      flowToParentMessageSchema.safeParse(
        flow({
          type: 'complete',
          'inquiry-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
          status: 'completed',
        }),
      ).success,
    ).toBe(true);
    expect(
      flowToParentMessageSchema.safeParse(flow({ type: 'error', code: 'camera_error' })).success,
    ).toBe(true);
    expect(EMBED_ERROR_CODES).toEqual([
      'application_error',
      'camera_error',
      'invalid_config',
      'unauthenticated',
      'inactive_template',
      'unknown',
    ]);
  });
});
