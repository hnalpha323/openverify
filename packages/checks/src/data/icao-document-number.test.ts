import { describe, expect, it } from 'vitest';
import { ICAO_DOCUMENT_NUMBER_SOURCE, icaoDocumentNumberValid } from './icao-document-number.js';

describe('icaoDocumentNumberValid (C33)', () => {
  it('cites ICAO Doc 9303', () => {
    expect(ICAO_DOCUMENT_NUMBER_SOURCE.citation).toMatch(/Doc 9303/);
    expect(ICAO_DOCUMENT_NUMBER_SOURCE.url).toMatch(/^https:\/\/www\.icao\.int\//);
  });

  it.each([
    ['L898902C3', 'TD3'],
    ['X12K45P78', 'TD1'],
    ['D23145890', 'TD2'],
    ['L8988901C', 'MRVA'],
    ['L8988901C', 'MRVB'],
    ['1', 'TD3'],
    ['D23145890123', 'TD1'],
    ['D2314589012345', 'TD2'],
    ['D2314589012345678901234', 'TD1'],
  ] as const)('accepts %j on a %s', (number, format) => {
    expect(icaoDocumentNumberValid(number, format)).toBe(true);
  });

  it.each([
    ['', 'TD3'],
    ['L898902C34', 'TD3'],
    ['L898902C34', 'MRVA'],
    ['D231458901234567', 'TD2'],
    ['D23145890123456789012345', 'TD1'],
    ['D2314<890', 'TD1'],
    ['d23145890', 'TD1'],
    ['D2314-890', 'TD1'],
  ] as const)('rejects %j on a %s', (number, format) => {
    expect(icaoDocumentNumberValid(number, format)).toBe(false);
  });
});
