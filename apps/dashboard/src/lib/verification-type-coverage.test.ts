// @vitest-environment node
/**
 * C50.6: no client meets a verification type it cannot decode. Each resource type has its full
 * and flow schemas, a golden API fixture, a dashboard label and an Android enum value; each file
 * kind has a dashboard label. The fixtures and the Android source are read from the repository.
 */
import { readFileSync } from 'node:fs';
import {
  FILE_KINDS,
  flowVerificationResourceSchema,
  VERIFICATION_RESOURCE_TYPES,
  verificationDocumentSchema,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { FILE_KIND_LABELS, VERIFICATION_TYPE_LABELS } from './labels';

const repo = (file: string) => new URL(`../../../../${file}`, import.meta.url);

const ANDROID_WIRE_ENUMS = readFileSync(
  repo('android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/model/WireEnums.kt'),
  'utf8',
);

/** The `VerificationType` entries of the Android SDK, as `[apiValue, resourceType]`. */
const ANDROID_TYPES = [
  ...(/enum class VerificationType\(([\s\S]*?)\n}/.exec(ANDROID_WIRE_ENUMS)?.[1] ?? '').matchAll(
    /^\s+[A-Z_]+\("([a-z-]+)", "(verification\/[a-z-]+)"\)/gm,
  ),
].map(([, api, resource]) => [api, resource]);

const AT = '2026-10-20T12:00:00.000Z';

describe('every verification resource type (C50.6)', () => {
  it.each(VERIFICATION_RESOURCE_TYPES)('%s is decoded and named by every client', (type) => {
    const fixture: unknown = JSON.parse(
      readFileSync(repo(`contracts/fixtures/api/${type.replace('/', '-')}.json`), 'utf8'),
    );
    const flow = flowVerificationResourceSchema.safeParse({
      type,
      id: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
      attributes: { status: 'initiated', 'retry-hints': [], 'created-at': AT, 'updated-at': AT },
    });

    expect(verificationDocumentSchema.parse(fixture).data.type).toBe(type);
    expect(flow.success, flow.error?.message).toBe(true);
    expect(VERIFICATION_TYPE_LABELS[type]).toMatch(/^[A-Z][^_]{1,40}$/);
    expect(ANDROID_TYPES.map(([, resource]) => resource)).toContain(type);
  });

  it('gives each type its own label', () => {
    const labels = VERIFICATION_RESOURCE_TYPES.map((type) => VERIFICATION_TYPE_LABELS[type]);

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('every file kind (C52.4)', () => {
  it.each(FILE_KINDS)('%s has its own label', (kind) => {
    expect(FILE_KIND_LABELS[kind]).toMatch(/^[A-Z][^_]{1,60}$/);
    expect(
      FILE_KINDS.filter((other) => FILE_KIND_LABELS[other] === FILE_KIND_LABELS[kind]),
    ).toEqual([kind]);
  });
});
