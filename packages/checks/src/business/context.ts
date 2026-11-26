/**
 * The shared contexts of the business registry and business website checks (C61.7): the input,
 * the template, and what the registers answered, read once: the record the first register to find
 * the business holds, whether an authoritative register said a submitted number is not on it, and
 * whether any register covering the country answered.
 */
import type { CheckProvider, VerificationTemplateConfig } from '@openverify/core';
import type { EnvironmentKind } from '../data/feature-table.js';
import type {
  BusinessRegistryAnswer,
  BusinessRegistryRecord,
  BusinessWebsiteCheckInput,
  DatabaseBusinessCheckInput,
} from './inputs.js';
import { websiteHostOf } from './website.js';

/** What the registers answered, read in their order of asking. */
export type BusinessRegistryReading =
  /** No register is bound. */
  | { readonly kind: 'not_configured' }
  /** A register failed for good and none found the business. */
  | { readonly kind: 'error'; readonly provider: CheckProvider | null }
  /** Every bound register said it does not cover the country. */
  | { readonly kind: 'unsupported_country'; readonly provider: CheckProvider }
  | {
      readonly kind: 'found';
      readonly provider: CheckProvider;
      readonly record: BusinessRegistryRecord;
      readonly authoritative: boolean;
      readonly personsAvailable: boolean;
    }
  | {
      readonly kind: 'not_found';
      readonly provider: CheckProvider;
      /** An authoritative register said it does not hold the business. */
      readonly authoritative: boolean;
    };

export interface DatabaseBusinessContext {
  readonly input: DatabaseBusinessCheckInput;
  readonly template: VerificationTemplateConfig;
  readonly registry: BusinessRegistryReading;
}

export interface BusinessWebsiteContext {
  readonly input: BusinessWebsiteCheckInput;
  readonly template: VerificationTemplateConfig;
  readonly now: Date;
  readonly environment: EnvironmentKind;
  /** The URL's host, or `null` when no valid URL was entered. */
  readonly host: string | null;
}

/** Reads the registers' answers in their order of asking. */
export function businessRegistryReading(
  answers: readonly BusinessRegistryAnswer[] | undefined,
): BusinessRegistryReading {
  let errored = false;
  let authoritativeMiss: CheckProvider | null = null;
  let miss: CheckProvider | null = null;
  let unsupported: CheckProvider | null = null;
  for (const { outcome } of answers ?? []) {
    if (outcome.kind === 'error') {
      errored = true;
    } else if (outcome.kind === 'result') {
      const lookup = outcome.result;
      if (lookup.outcome === 'found') {
        return {
          kind: 'found',
          provider: outcome.provider,
          record: lookup.record,
          authoritative: lookup.authoritative,
          personsAvailable: lookup.personsAvailable,
        };
      }
      if (lookup.outcome === 'not_found') {
        miss ??= outcome.provider;
        if (lookup.authoritative) {
          authoritativeMiss ??= outcome.provider;
        }
      } else {
        unsupported ??= outcome.provider;
      }
    }
  }
  if (errored) {
    return { kind: 'error', provider: null };
  }
  if (authoritativeMiss !== null) {
    return { kind: 'not_found', provider: authoritativeMiss, authoritative: true };
  }
  if (miss !== null) {
    return { kind: 'not_found', provider: miss, authoritative: false };
  }
  return unsupported === null
    ? { kind: 'not_configured' }
    : { kind: 'unsupported_country', provider: unsupported };
}

/**
 * The first register covering the country that answered (found or not), or what stands in for
 * none: a failure, every register outside the country, or none bound.
 */
export function businessRegistryCoverage(
  answers: readonly BusinessRegistryAnswer[] | undefined,
):
  | { readonly kind: 'answered'; readonly provider: CheckProvider }
  | { readonly kind: 'error' | 'uncovered' | 'not_configured' } {
  let errored = false;
  let uncovered = false;
  for (const { outcome } of answers ?? []) {
    if (outcome.kind === 'error') {
      errored = true;
    } else if (outcome.kind === 'result') {
      if (outcome.result.outcome === 'unsupported_country') {
        uncovered = true;
      } else {
        return { kind: 'answered', provider: outcome.provider };
      }
    }
  }
  return { kind: errored ? 'error' : uncovered ? 'uncovered' : 'not_configured' };
}

/** Builds the context of one business registry verification. */
export function databaseBusinessContext(
  input: DatabaseBusinessCheckInput,
  template: VerificationTemplateConfig,
): DatabaseBusinessContext {
  return { input, template, registry: businessRegistryReading(input.registry) };
}

/** Builds the context of one business website verification: now unless given. */
export function businessWebsiteContext(
  input: BusinessWebsiteCheckInput,
  template: VerificationTemplateConfig,
): BusinessWebsiteContext {
  const url = input.values?.['website-url'];
  return {
    input,
    template,
    now: input.now ?? new Date(),
    environment: input.environment ?? 'production',
    host: typeof url === 'string' ? websiteHostOf(url) : null,
  };
}
