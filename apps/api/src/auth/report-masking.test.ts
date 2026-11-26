/**
 * C70.3 (P04, P15, P17): the report PII marks reach every exit `foundation-6` owns. A user without
 * `pii:view` gets each `PII_REPORT_ATTRIBUTES` member of a report as `null`, and `query` member-wise
 * (its keys stay), in a served resource (`mask.attributes`, the route and dashboard serializers) and
 * in the stored API-log bodies of creation, dismissal and review, whose members sit under
 * `data.attributes` (`maskPersonalData`). `api-log.query` is the one exemption: it is never given to
 * `mask.attributes`. Synthetic values only (the golden report fixture).
 */
import { readFileSync } from 'node:fs';
import { PII_REPORT_ATTRIBUTES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { maskPersonalData } from '../services/api-logs.js';
import { MASKED_ATTRIBUTES, UNMASKED, piiMaskFor } from './pii.js';
import type { Principal } from '../ports.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/fixtures/api/report-watchlist.json', import.meta.url),
    'utf8',
  ),
) as { data: { attributes: Record<string, unknown> } };
const attributes = fixture.data.attributes;

const viewer = {
  kind: 'user',
  permissions: new Set(['reports:read']),
} as unknown as Principal;

describe('C70.3: report attributes are masked for a user without pii:view', () => {
  it('lists every report PII attribute among the masked ones', () => {
    expect(MASKED_ATTRIBUTES).toEqual(expect.arrayContaining([...PII_REPORT_ATTRIBUTES]));
  });

  it('nulls each PII attribute of a report resource and masks query member-wise', () => {
    const masked = piiMaskFor(viewer).attributes(attributes);

    expect(masked.query).toEqual({
      'name-first': null,
      'name-last': null,
      birthdate: null,
      'address-country-code': null,
    });
    for (const name of ['matched-lists', 'ignore-list', 'matches']) {
      expect(masked[name], name).toBeNull();
    }
    expect(masked.status).toBe(attributes.status);
    expect(masked['has-match']).toBe(attributes['has-match']);
    expect(UNMASKED.attributes(attributes)).toEqual(attributes);
  });
});

describe('C70.3 (P04): the stored API-log bodies of report routes are masked', () => {
  it('masks the query of a creation request member-wise, and the report it answered', () => {
    const request = {
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': 'rptp_01JB00000000000000000000AA',
          query: { 'name-first': 'Avery', 'name-last': 'Quillfeather' },
        },
      },
    };

    expect(maskPersonalData(request)).toEqual({
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': 'rptp_01JB00000000000000000000AA',
          query: { 'name-first': null, 'name-last': null },
        },
      },
    });
    const response = maskPersonalData(fixture) as typeof fixture;
    expect(response.data.attributes['matched-lists']).toBeNull();
    expect(response.data.attributes.query).toEqual({
      'name-first': null,
      'name-last': null,
      birthdate: null,
      'address-country-code': null,
    });
  });

  it('nulls the reason, the entity id and the comment of a dismissal and a review', () => {
    const dismissal = {
      data: { attributes: { reason: 'Another person', 'entity-id': 'openverify-sandbox:SYN-1' } },
    };
    const review = {
      data: {
        attributes: {
          'review-type': 'record',
          'record-token': 'rpm_01JB00000000000000000000AA',
          'review-status': 'false_positive',
          comment: 'Different birth year',
        },
      },
    };

    expect(maskPersonalData(dismissal)).toEqual({
      data: { attributes: { reason: null, 'entity-id': null } },
    });
    expect(maskPersonalData(review)).toEqual({
      data: {
        attributes: {
          'review-type': 'record',
          'record-token': 'rpm_01JB00000000000000000000AA',
          'review-status': 'false_positive',
          comment: null,
        },
      },
    });
  });

  it("keeps an API log's own query parameters, which are not a report's query (P17)", () => {
    expect(maskPersonalData({ 'filter[status]': 'ready' })).toEqual({
      'filter[status]': 'ready',
    });
  });
});
