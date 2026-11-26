/** Test helpers: government ID evaluation contexts over the golden fixtures. Test-only. */
import type { VerificationTemplateConfig } from '@openverify/core';
import { governmentIdContext, type GovernmentIdContext } from '../government-id/context.js';
import type { GovernmentIdCheckInput } from '../government-id/inputs.js';
import { goldenAnalysis, type FullAnalysis } from './fixtures.js';

export const NOW = new Date('2026-10-21T12:00:00Z');

/** Every §4.1 government ID check enabled and required, with `config` where given. */
export function template(
  configs: Readonly<Record<string, Record<string, unknown>>> = {},
  extra: Partial<VerificationTemplateConfig> = {},
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      Object.entries(configs).map(([id, config]) => [
        id,
        { enabled: true, required: true, config },
      ]),
    ),
    ...extra,
  };
}

/** A context over the golden Utopia card (both sides, sandbox, NOW), with overrides. */
export function contextFor(
  overrides: Partial<GovernmentIdCheckInput> & { analysis?: FullAnalysis } = {},
  config: VerificationTemplateConfig = template(),
): GovernmentIdContext {
  return governmentIdContext(
    {
      analysis: goldenAnalysis(),
      requiredSides: 'both',
      uploads: { front: { sha256: 'a'.repeat(64) }, back: { sha256: 'b'.repeat(64) } },
      environment: 'sandbox',
      now: NOW,
      ...overrides,
    },
    config,
  );
}
