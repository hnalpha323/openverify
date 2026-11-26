import { describe, expect, it } from 'vitest';
import {
  SPECIMEN_DOCUMENT_NUMBERS,
  SPECIMEN_MARKER_PHRASES,
  SPECIMEN_MARKER_WORDS,
  isSpecimenDocumentNumber,
  specimenMarkersIn,
} from './specimen-markers.js';

describe('the specimen markers (C33, frozen)', () => {
  it('are exactly the plan list, frozen', () => {
    expect(SPECIMEN_MARKER_WORDS).toEqual([
      'SPECIMEN',
      'ESPECIMEN',
      'SAMPLE',
      'MUSTER',
      'ECHANTILLON',
      'CAMPIONE',
      'FACSIMILE',
      'MODELO',
      'VZOR',
      'WZOR',
      'NAYTE',
      'PROVE',
      'VOID',
    ]);
    expect(SPECIMEN_MARKER_PHRASES).toEqual(['NOT A REAL DOCUMENT']);
    expect(SPECIMEN_DOCUMENT_NUMBERS).toEqual(['L898902C3', 'D23145890', 'L8988901C']);
    expect(Object.isFrozen(SPECIMEN_MARKER_WORDS)).toBe(true);
    expect(Object.isFrozen(SPECIMEN_MARKER_PHRASES)).toBe(true);
    expect(Object.isFrozen(SPECIMEN_DOCUMENT_NUMBERS)).toBe(true);
  });

  it.each([
    ['SPECIMEN', ['SPECIMEN']],
    ['specimen', ['SPECIMEN']],
    ['Spécimen', ['SPECIMEN']],
    ['ÉCHANTILLON', ['ECHANTILLON']],
    ['Näyte', ['NAYTE']],
    ['UTOPIA / MUSTER / SAMPLE', ['MUSTER', 'SAMPLE']],
    ['this is NOT A REAL DOCUMENT.', ['NOT A REAL DOCUMENT']],
    ['not  a   real document', ['NOT A REAL DOCUMENT']],
    ['VOID', ['VOID']],
  ])('finds the markers in %j', (text, markers) => {
    expect(specimenMarkersIn(text)).toEqual(markers);
  });

  it.each([
    'SPECIMENS',
    'SAMPLES',
    'AVOIDED',
    'TEST CARD',
    'OPENVERIFY SYNTHETIC TEST CARD',
    'PROVENCE',
    'MODELOS',
    'NOT A DOCUMENT',
    '',
  ])('finds none in %j (whole words only; TEST and SYNTHETIC are not markers)', (text) => {
    expect(specimenMarkersIn(text)).toEqual([]);
  });

  it.each([
    ['L898902C3', true],
    ['l898902c3', true],
    ['D23145890', true],
    ['D2314 5890', true],
    ['L8988901C', true],
    ['X12K45P78', false],
    ['', false],
  ])('knows whether %j is a specimen document number (%j)', (number, expected) => {
    expect(isSpecimenDocumentNumber(number)).toBe(expected);
  });
});
