/**
 * Phase 12A F3, F4 (Workflow 12A capture-12a): the retake prompt's reasons, its "use this photo
 * anyway", and the back's barcode hint are in all five built-in catalogs, translated (en is the
 * source; fr, es, de and ar are machine-drafted, as the rest of those catalogs, C161.1).
 */
import { describe, expect, it } from 'vitest';
import { PHOTO_PROBLEMS } from '../lib/photo-check';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES } from './languages';

const english = CATALOGS.en.capture;

describe.each(SUPPORTED_LANGUAGES)('the %s catalog', (language) => {
  const capture = CATALOGS[language].capture;

  it('names every reason the photo check gives, and offers to use the photo anyway', () => {
    for (const problem of PHOTO_PROBLEMS) {
      expect(capture.photoCheck[problem].trim()).not.toBe('');
    }
    expect(capture.photoCheck.useAnyway.trim()).not.toBe('');
  });

  it('asks for a sharp barcode inside the frame on the back', () => {
    expect(capture.barcodeHint.trim()).not.toBe('');
  });

  it.runIf(language !== 'en')('is translated', () => {
    for (const problem of PHOTO_PROBLEMS) {
      expect(capture.photoCheck[problem]).not.toBe(english.photoCheck[problem]);
    }
    expect(capture.photoCheck.useAnyway).not.toBe(english.photoCheck.useAnyway);
    expect(capture.barcodeHint).not.toBe(english.barcodeHint);
  });
});
