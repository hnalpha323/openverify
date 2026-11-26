import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { PO_BOX_PATTERNS, idPoBoxDetection, normalizeAddress } from './id-po-box-detection.js';

describe('idPoBoxDetection', () => {
  it('passes a street address', () => {
    const result = idPoBoxDetection({ address: '123 Main Street, Springfield, IL 62701' });
    expect(result).toEqual({
      name: 'id_po_box_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { matchedPatterns: [] },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    // United States and generic English
    ['PO Box 123', 'po_box'],
    ['P.O. Box 4567, Austin TX', 'po_box'],
    ['P. O. Box 12', 'po_box'],
    ['p.o.box 9', 'po_box'],
    ['POBox 77', 'po_box'],
    ['Post Office Box 1000', 'po_box'],
    ['PO Drawer 55', 'po_box'],
    ['POB 42', 'po_box'],
    ['P.O.B. 42', 'po_box'],
    ['GPO Box 1234, Sydney NSW 2001', 'po_box'],
    ['Box 15, Route 2', 'box_number'],
    ['Smith Farm, Box #3', 'box_number'],
    // Military and diplomatic mail
    ['Unit 2050 Box 4190, APO AP 96278', 'military'],
    ['PSC 1234 Box 5678, APO AE 09012', 'military'],
    ['CMR 480 Box 1234', 'military'],
    ['USS Nimitz, FPO AP 96620', 'military'],
    ['Embassy Name, DPO AE 09498', 'military'],
    ['APO, AE 09012', 'military'],
    // Commercial mail receiving agencies and Commonwealth variants
    ['500 Market St, PMB 205', 'private_mailbox'],
    ['Private Mailbox 12', 'private_mailbox'],
    ['Private Bag 4800, Christchurch', 'private_bag'],
    ['Locked Bag 2000', 'private_bag'],
    // International
    ['Apartado 1234, Madrid', 'apartado'],
    ['Apartado de Correos 56', 'apartado'],
    ['Apartado Aéreo 3456, Bogotá', 'apartado'],
    ['Apdo. 789', 'apartado'],
    ['Apdo Postal 12', 'apartado'],
    ['Casilla 123, Santiago', 'casilla'],
    ['Casilla de Correo 45', 'casilla'],
    ['Postfach 10 20 30, Berlin', 'postfach'],
    ['Boîte Postale 12', 'boite_postale'],
    ['BP 45, Dakar', 'boite_postale'],
    ['B.P. 1234', 'boite_postale'],
    ['Caixa Postal 100, São Paulo', 'caixa_postal'],
    ['Casella Postale 7', 'casella_postale'],
    ['Postbus 1234, Amsterdam', 'postbus'],
    ['Postboks 55, Oslo', 'postboks'],
    ['Postilokero 3', 'postilokero'],
    ['Skrytka pocztowa 12', 'skrytka_pocztowa'],
    ['Posta Kutusu 45', 'posta_kutusu'],
    ['General Delivery, Anytown', 'general_delivery'],
    ['Poste Restante, Lyon', 'general_delivery'],
    ['Postlagernd, Wien', 'general_delivery'],
  ])('detects %j', (address, pattern) => {
    const result = idPoBoxDetection({ address });
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['po_box_detected']);
    expect(result.metadata.matchedPatterns).toContain(pattern);
  });

  it.each([
    '42 Box Hill Road, Melbourne',
    '9 Boxwood Lane',
    '17 Post Road, Westport',
    'Apartamento 4B, Calle Mayor 12',
    '1200 Apollo Drive',
    'Apo Street 5, Davao',
    'Postfachweg 3', // street name, not a mailbox
    '12 Spoon Street',
    'Robinson Crescent 8',
    'Pobrezni 11, Praha',
    'Unit 5, 10 Harbour Road',
    'BPM Tower, Level 4',
  ])('does not flag %j', (address) => {
    expect(idPoBoxDetection({ address }).status).toBe('passed');
  });

  it('reads multi-line addresses and reports each pattern once', () => {
    const result = idPoBoxDetection({
      address: ['Acme Ltd', 'PO Box 1', 'P.O. Box 2', 'Postfach 3'],
    });
    expect(result.status).toBe('failed');
    expect(result.metadata.matchedPatterns).toEqual(['po_box', 'postfach']);
  });

  it('treats a box number at the start of a later line as a PO box', () => {
    expect(idPoBoxDetection({ address: ['Acme Ltd', 'Box 99'] }).status).toBe('failed');
  });

  it('is case and accent insensitive', () => {
    expect(idPoBoxDetection({ address: 'BOÎTE POSTALE 5' }).status).toBe('failed');
    expect(idPoBoxDetection({ address: 'po box 5' }).status).toBe('failed');
  });

  it('never copies the address into the result', () => {
    expect(JSON.stringify(idPoBoxDetection({ address: 'PO Box 31337' }))).not.toContain('31337');
  });

  it.each([undefined, null, '', '   ', [], ['', ' ']])(
    'answers input_missing without an address (%j)',
    (address) => {
      expect(idPoBoxDetection({ address })).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    },
  );
});

describe('the PO-box exports (C67), for the database PO-box check', () => {
  it('expose the mailbox patterns and the address normaliser the check uses', () => {
    expect(PO_BOX_PATTERNS.map(([id]) => id)).toEqual(
      expect.arrayContaining(['po_box', 'military', 'private_mailbox', 'apartado', 'postfach']),
    );
    const address = normalizeAddress(['P.O. Box 12', 'Utopia City']);
    expect(address).toBe('p o box 12\nutopia city');
    expect(PO_BOX_PATTERNS.some(([, pattern]) => pattern.test(address))).toBe(true);
    expect(
      PO_BOX_PATTERNS.some(([, pattern]) => pattern.test(normalizeAddress(['1 Sample Street']))),
    ).toBe(false);
  });
});
