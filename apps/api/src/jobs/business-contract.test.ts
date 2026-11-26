/**
 * C51.2 contract for the business registry and business website jobs: what their evaluators may
 * emit is exactly what the contracts publish for the nine business checks, so the jobs never write
 * a reason the clients and the console do not know. `packages/checks` cannot import
 * `@openverify/contracts`, so the two lists meet here. The two golden fixtures parse.
 */
import { readFileSync } from 'node:fs';
import { BUSINESS_EVALUATOR_REASONS } from '@openverify/checks';
import {
  BUSINESS_CHECK_IDS,
  BUSINESS_CHECK_REASONS,
  businessWebsiteVerificationResourceSchema,
  databaseBusinessVerificationResourceSchema,
} from '@openverify/contracts';
import { CHECK_REGISTRY } from '@openverify/core';
import { describe, expect, it } from 'vitest';

const fixture = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/fixtures/api/${name}`, import.meta.url), 'utf8'),
    ) as { data: unknown }
  ).data;

describe('the business reasons (C51.2)', () => {
  it('are the same per check, in the same order, in the evaluators and the contracts', () => {
    expect(BUSINESS_EVALUATOR_REASONS).toEqual(BUSINESS_CHECK_REASONS);
  });

  it('cover every business registry and website check of the registry', () => {
    const registered = CHECK_REGISTRY.filter(
      (check) =>
        check.verificationType === 'database_business' ||
        check.verificationType === 'business_website',
    ).map((check) => check.id);

    expect([...registered].sort()).toEqual([...BUSINESS_CHECK_IDS].sort());
    expect(Object.keys(BUSINESS_EVALUATOR_REASONS).sort()).toEqual([...BUSINESS_CHECK_IDS].sort());
  });
});

describe('the golden business fixtures (C52.8)', () => {
  it('parse as the resources the attribute hooks serve', () => {
    expect(
      databaseBusinessVerificationResourceSchema.safeParse(
        fixture('verification-database-business.json'),
      ).success,
    ).toBe(true);
    expect(
      businessWebsiteVerificationResourceSchema.safeParse(
        fixture('verification-business-website.json'),
      ).success,
    ).toBe(true);
  });
});
