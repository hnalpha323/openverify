/**
 * C124.3: what only the egress rules can judge in a settings change: a port that is a Fetch bad port
 * and a CIDR entry outside a private or CGNAT block (422 naming the category). `foundation-8a` froze
 * the signature and calls it from `services/settings.ts`, before anything is written. The contract
 * already holds each list's shape and cap.
 */
import type { DashboardUpdateSettingsBody } from '@openverify/contracts';
import { cidrCategory } from '../../../webhooks/ssrf.js';

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** The Fetch standard's "bad port" table, as the research note read it (2026-10-19). */
export const FETCH_BAD_PORTS: ReadonlySet<number> = new Set([
  0,
  1,
  7,
  9,
  11,
  13,
  15,
  17,
  19,
  ...range(20, 23),
  25,
  37,
  42,
  43,
  53,
  69,
  77,
  79,
  87,
  95,
  ...range(101, 104),
  ...range(109, 111),
  113,
  115,
  117,
  119,
  123,
  135,
  137,
  139,
  143,
  161,
  179,
  389,
  427,
  465,
  ...range(512, 515),
  526,
  ...range(530, 532),
  540,
  548,
  554,
  556,
  563,
  587,
  601,
  636,
  989,
  990,
  993,
  995,
  1719,
  1720,
  1723,
  2049,
  3659,
  4045,
  4190,
  5060,
  5061,
  6000,
  6566,
  ...range(6665, 6669),
  6679,
  6697,
  10080,
]);

/** A refusal: which setting, and a detail that never echoes a value. */
export interface WorkflowEgressSettingsProblem {
  setting: string;
  detail: string;
}

/** The refusal of a settings change, or `null`. It reads only the two members it judges. */
export function workflowEgressSettingsProblem(
  body: DashboardUpdateSettingsBody,
): WorkflowEgressSettingsProblem | null {
  if (body['workflow-http-ports']?.some((port) => FETCH_BAD_PORTS.has(port)) === true) {
    return {
      setting: 'workflow-http-ports',
      detail: 'A workflow request can never use a Fetch bad port.',
    };
  }
  for (const cidr of body['workflow-http-private-cidrs'] ?? []) {
    const category = cidrCategory(cidr);
    if (category !== null) {
      return {
        setting: 'workflow-http-private-cidrs',
        detail: `A block must lie inside private or CGNAT space; this one overlaps ${category} space.`,
      };
    }
  }
  return null;
}
