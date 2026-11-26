import { describe, expect, it } from 'vitest';
import {
  CASE_ATTACHMENT_MEDIA_TYPES,
  CASE_ATTACHMENT_SCAN_PROVIDERS,
  CASE_ATTACHMENT_SCAN_STATUSES,
  CASE_ATTACHMENT_TYPES,
  CASE_EXPORT_FORMATS,
  CASE_EXPORT_STATUSES,
  CASE_LIMITS,
  CASE_RENDITION_MEDIA_TYPES,
  CASE_RENDITION_STATUSES,
  caseAttachmentScanProviderSchema,
  caseAttachmentScanStatusSchema,
  caseExportStatusSchema,
} from '../index.js';

describe('the file, rendition and export vocabularies (C135, C138)', () => {
  it('names each attachment type by the media type its magic bytes read as (C135.2)', () => {
    expect(Object.keys(CASE_ATTACHMENT_MEDIA_TYPES)).toEqual([...CASE_ATTACHMENT_TYPES]);
    expect(CASE_ATTACHMENT_MEDIA_TYPES).toEqual({
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      pdf: 'application/pdf',
    });
  });

  it('holds every scan status, and names only the scanners that answer (C135.5, H20)', () => {
    expect(CASE_ATTACHMENT_SCAN_STATUSES).toEqual([
      'not_scanned',
      'pending',
      'clean',
      'infected',
      'error',
    ]);
    expect(CASE_ATTACHMENT_SCAN_PROVIDERS).toEqual(['sandbox', 'clamd']);
    expect(caseAttachmentScanProviderSchema.safeParse('none').success).toBe(false);
    expect(caseAttachmentScanStatusSchema.safeParse('safe').success).toBe(false);
  });

  it('holds where a rendition stands and what it is re-encoded as (C135.3)', () => {
    expect(CASE_RENDITION_STATUSES).toEqual(['pending', 'ready', 'failed', 'deleted']);
    expect(CASE_RENDITION_MEDIA_TYPES).toEqual(['image/jpeg', 'image/png']);
  });

  it('exports CSV or JSON, kept 24 hours (C138.1, decision 69)', () => {
    expect(CASE_EXPORT_FORMATS).toEqual(['csv', 'json']);
    expect(CASE_EXPORT_STATUSES).toEqual(['pending', 'running', 'completed', 'failed', 'expired']);
    expect(caseExportStatusSchema.safeParse('done').success).toBe(false);
  });

  it('states the (F) limits with their basis (C135, C138)', () => {
    expect(CASE_LIMITS['attachment-bytes'].value).toBe(10 * 1024 * 1024);
    expect(CASE_LIMITS['patch-attachment-bytes'].value).toBe(10 * 1024 * 1024);
    expect(CASE_LIMITS['patch-body-bytes'].value).toBe(14 * 1024 * 1024);
    expect(CASE_LIMITS['rendition-pages'].value).toBe(20);
    expect(CASE_LIMITS['rendition-page-side-px'].value).toBe(1600);
    expect(CASE_LIMITS['scan-attempts'].value).toBe(3);
    expect(CASE_LIMITS['export-hours'].value).toBe(24);
    for (const name of [
      'filename-characters',
      'rendition-image-side-px',
      'rendition-bytes',
      'rendition-retry-seconds',
    ] as const) {
      expect(CASE_LIMITS[name].basis, name).toBe('provisional');
      expect(CASE_LIMITS[name].source, name).toMatch(/C13[58]/);
    }
  });
});
