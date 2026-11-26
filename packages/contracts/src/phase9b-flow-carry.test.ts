/**
 * Workflow 9B Stage 1a, (F): the contracts of the 9A items S4-12 carried (the orchestrator's decisions
 * before 9B): the session's links, the per-inquiry expiry windows on the inquiry, and the preview,
 * simulate and preset schemas completed against C156.1 and C156.4. Read through the package root.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  expect(found, name).toBeDefined();
  return found as z.ZodType;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;

describe('the session links (9A Stage 3 amendment 47, C162.3)', () => {
  it('serves the version help and privacy URLs, https only, null when unset', () => {
    const session = readFixture('api/flow-session-links.json');
    expect(schema('flowSessionResponseSchema').parse(session)).toEqual(session);
    const links = (value: unknown) => parses('flowSessionLinksSchema', value);
    expect(links({ 'help-url': 'https://help.example.test/verify', 'privacy-url': null })).toBe(
      true,
    );
    expect(links({ 'help-url': 'http://help.example.test', 'privacy-url': null })).toBe(false);
    expect(links({ 'help-url': 'javascript:alert(1)', 'privacy-url': null })).toBe(false);
  });
});

describe('the per-inquiry expiry windows (9A Stage 3 amendment 21, C151.10)', () => {
  it('serves the windows set at creation on the inquiry, null when the version decides', () => {
    const inquiry = readFixture('api/inquiry-expiry-windows.json');
    expect(schema('inquiryDocumentSchema').parse(inquiry)).toEqual(inquiry);
    expect(inquiry).toMatchObject({
      data: {
        attributes: {
          'expiration-after-start-interval-seconds': 7200,
          'expiration-after-resume-interval-seconds': null,
        },
      },
    });
  });
});

describe('the preview carries the contrast gate answer (C156.1, review H15)', () => {
  it('lists every finding of both palettes, failures and warnings, ratios unrounded', () => {
    const preview = readFixture('api/template-preview.json');
    expect(schema('templatePreviewDocumentSchema').parse(preview)).toEqual(preview);
    const attributes = (preview as { data: { attributes: Record<string, unknown> } }).data
      .attributes;
    expect(attributes.contrast).toEqual({
      status: 'passed',
      findings: expect.any(Array) as unknown,
    });
  });
});

describe('simulate reaches every scope root and says each step notes (C156.4)', () => {
  it('sets the inquiry tags and a workflow error type, and names the notes', () => {
    expect(
      parses('simulateInquiryTemplateVersionBodySchema', {
        meta: {
          scope: {
            inquiry: { tags: ['vip'], status: 'pending' },
            workflows: { s_run00001: { status: 'errored', 'error-type': 'timeout' } },
          },
        },
      }),
    ).toBe(true);
    const simulation = readFixture('api/template-simulation.json');
    expect(schema('templateSimulationDocumentSchema').parse(simulation)).toEqual(simulation);
    const steps = (simulation as { data: { attributes: { steps: { notes?: unknown }[] } } }).data
      .attributes.steps;
    expect(steps.every((step) => Array.isArray(step.notes))).toBe(true);
  });
});
