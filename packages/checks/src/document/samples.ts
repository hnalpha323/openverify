/**
 * Synthetic supporting documents in the four covered languages, one per class, for the
 * classifier's unit tests: invented issuers named after Utopia, the invented holder Quinn
 * Valemont, invented streets and towns and the unassigned postal code 00000. They are not the
 * held-out set (C60.7), which `fixtures-5b` writes apart from the classifier's author, and the
 * classifier's constants were fixed before these were written (H23). Not exported from the
 * package.
 */
import type { DocumentClass } from './inputs.js';
import type { DocumentLanguage } from './lexicons/types.js';
import { utilityBillLines, type LineSpec } from './testing.js';

export const CLASS_SAMPLES: Readonly<
  Record<DocumentLanguage, Readonly<Record<DocumentClass, readonly LineSpec[]>>>
> = {
  en: {
    utility_bill: utilityBillLines(),
    bank_statement: [
      { text: 'UTOPIA SAVINGS BANK', height: 70 },
      'Statement of account',
      'Statement period: 01 Sep 2026 to 30 Sep 2026',
      { text: 'QUINN VALEMONT', y: 450 },
      '14 LANTERN ROW',
      'MERIDALE UT 00000',
      { text: 'Opening balance 1,204.50', y: 750 },
      '02 Sep Card payment Meridale Market 23.10',
      '05 Sep Transfer from savings 200.00',
      'Closing balance 1,381.40',
      'Sort code 00-00-00 Account number 00000001',
    ],
    lease: [
      { text: 'RESIDENTIAL LEASE AGREEMENT', height: 70 },
      'This lease agreement is made on 1 March 2026 between the landlord and the tenant.',
      'Landlord: Meridale Homes Cooperative',
      'Tenant: Quinn Valemont',
      'Premises: 14 Lantern Row, Meridale UT 00000',
      'Term: 1 March 2026 to 28 February 2027',
      'Monthly rent: 950.00',
      'Security deposit: 950.00',
      'Signature of tenant: ____________',
    ],
    pay_stub: [
      { text: 'UTOPIA ORCHARD COOPERATIVE', height: 70 },
      'Earnings statement',
      'Pay period: 01 Oct 2026 - 15 Oct 2026',
      'Pay date: 16 October 2026',
      'Employee: Quinn Valemont',
      'Gross pay 2,150.00',
      'Federal income tax 215.00',
      'Total deductions 402.10',
      'Net pay 1,747.90',
      'Year to date gross 32,250.00',
    ],
    tax_document: [
      { text: 'Form W-2 Wage and Tax Statement 2025', height: 70 },
      "a Employee's social security number",
      'b Employer identification number',
      '1 Wages, tips, other compensation 41,200.00',
      '2 Federal income tax withheld 4,120.00',
      '3 Social security wages 41,200.00',
      '4 Social security tax withheld 2,554.40',
      "Copy B To Be Filed With Employee's Federal Tax Return",
    ],
  },
  es: {
    utility_bill: [
      { text: 'COMPAÑÍA DE AGUAS DE UTOPÍA', height: 70 },
      'Factura de agua',
      'Fecha de emisión: 30/09/2026',
      'Periodo de facturación: 01/07/2026 al 30/09/2026',
      { text: 'QUINN VALEMONT', y: 520 },
      'CALLE DEL FAROL 14',
      '00000 MERIDALE',
      { text: 'Lectura anterior: 1204', y: 800 },
      'Lectura actual: 1222',
      'Consumo: 18 m3',
      'Importe total: 48,20 €',
    ],
    bank_statement: [
      { text: 'BANCO DE UTOPÍA', height: 70 },
      'Extracto de cuenta',
      'Fecha del extracto: 30/09/2026',
      'Titular: Quinn Valemont',
      'Saldo anterior: 1.204,50',
      '02/09 Pago con tarjeta 23,10',
      '05/09 Transferencia recibida 200,00',
      'Saldo final: 1.381,40',
    ],
    lease: [
      { text: 'CONTRATO DE ARRENDAMIENTO DE VIVIENDA', height: 70 },
      'En Meridale, a 1 de marzo de 2026',
      'El arrendador y el arrendatario acuerdan lo siguiente:',
      'Arrendatario: Quinn Valemont',
      'Duración del contrato: un año a partir del 1 de marzo de 2026',
      'Renta mensual: 950,00 €',
      'Fianza: 950,00 €',
      'Firma del arrendatario: ____________',
    ],
    pay_stub: [
      { text: 'COOPERATIVA HORTÍCOLA DE UTOPÍA', height: 70 },
      'Recibo de nómina',
      'Periodo de liquidación: 01/10/2026 al 31/10/2026',
      'Trabajador: Quinn Valemont',
      'Salario base 1.800,00',
      'Total devengado 2.150,00',
      'Seguridad social 136,50',
      'IRPF 215,00',
      'Total a deducir 351,50',
      'Líquido a percibir 1.798,50',
    ],
    tax_document: [
      { text: 'HACIENDA DE UTOPÍA', height: 70 },
      'Declaración de la renta',
      'Modelo 100',
      'Ejercicio 2025',
      'Contribuyente: Quinn Valemont',
      'Base imponible general 32.500,00',
      'Cuota íntegra 6.120,00',
      'Retenciones 5.900,00',
    ],
  },
  fr: {
    utility_bill: [
      { text: "RÉGIE DES EAUX D'UTOPIE", height: 70 },
      "Facture d'eau",
      'Date de facture : 30/09/2026',
      'Période de facturation : du 01/07/2026 au 30/09/2026',
      { text: 'QUINN VALEMONT', y: 520 },
      '14 RUE DE LA LANTERNE',
      '00000 MÉRIDALE',
      { text: 'Ancien index : 1204', y: 800 },
      'Nouvel index : 1222',
      'Consommation : 18 m3',
      'Montant à payer : 48,20 €',
    ],
    bank_statement: [
      { text: "BANQUE D'UTOPIE", height: 70 },
      'Relevé de compte',
      'Date du relevé : 30/09/2026',
      'Titulaire du compte : Quinn Valemont',
      'Ancien solde au 31/08/2026 : 1 204,50',
      '02/09 Paiement par carte 23,10',
      '05/09 Virement reçu 200,00',
      'Nouveau solde au 30/09/2026 : 1 381,40',
    ],
    lease: [
      { text: 'CONTRAT DE LOCATION', height: 70 },
      "Bail d'habitation",
      'Entre le bailleur et le locataire désignés ci-dessous',
      'Locataire : Quinn Valemont',
      "Date de prise d'effet : 01/03/2026",
      'Durée du bail : 3 ans',
      'Loyer mensuel : 950,00 €',
      'Dépôt de garantie : 950,00 €',
      'Signature du locataire : ____________',
    ],
    pay_stub: [
      { text: "COOPÉRATIVE FRUITIÈRE D'UTOPIE", height: 70 },
      'Bulletin de paie',
      'Période de paie : du 01/10/2026 au 31/10/2026',
      'Salarié : Quinn Valemont',
      'Salaire brut 2 150,00',
      'Cotisations salariales 480,00',
      'Net imposable 1 720,00',
      'Net à payer 1 670,00',
    ],
    tax_document: [
      { text: "CENTRE DES IMPÔTS D'UTOPIE", height: 70 },
      "Avis d'impôt sur le revenu",
      'Impôt sur les revenus de 2025',
      'Numéro fiscal : 0000000000000',
      'Revenu fiscal de référence : 32 500',
      'Nombre de parts : 1',
    ],
  },
  de: {
    utility_bill: [
      { text: 'STADTWERKE UTOPIA', height: 70 },
      'Wasserrechnung',
      'Rechnungsdatum: 30.09.2026',
      'Abrechnungszeitraum: 01.07.2026 bis 30.09.2026',
      { text: 'QUINN VALEMONT', y: 520 },
      'LATERNENWEG 14',
      '00000 MERIDALE',
      { text: 'Zählerstand alt: 1204', y: 800 },
      'Zählerstand neu: 1222',
      'Verbrauch: 18 m3',
      'Rechnungsbetrag: 48,20 €',
    ],
    bank_statement: [
      { text: 'UTOPIA BANK', height: 70 },
      'Kontoauszug Nr. 9',
      'Auszugsdatum: 30.09.2026',
      'Kontoinhaber: Quinn Valemont',
      'Alter Kontostand: 1.204,50',
      '02.09. Kartenzahlung 23,10',
      '05.09. Gutschrift Überweisung 200,00',
      'Neuer Kontostand: 1.381,40',
    ],
    lease: [
      { text: 'MIETVERTRAG ÜBER WOHNRAUM', height: 70 },
      'Zwischen dem Vermieter und dem Mieter wird folgender Vertrag geschlossen:',
      'Mieter: Quinn Valemont',
      'Mietsache: Laternenweg 14, 00000 Meridale',
      'Mietbeginn: 01.03.2026',
      'Das Mietverhältnis ist auf unbestimmte Zeit geschlossen.',
      'Kaltmiete: 950,00 €',
      'Kaution: 2.850,00 €',
      'Unterschrift des Mieters: ____________',
    ],
    pay_stub: [
      { text: 'UTOPIA OBSTBAU GENOSSENSCHAFT', height: 70 },
      'Entgeltabrechnung Oktober 2026',
      'Abrechnungsmonat: 10/2026',
      'Arbeitnehmer: Quinn Valemont',
      'Gesamtbrutto 2.150,00',
      'Lohnsteuer 215,00',
      'Sozialversicherung 430,00',
      'Auszahlungsbetrag 1.505,00',
    ],
    tax_document: [
      { text: 'FINANZAMT UTOPIA', height: 70 },
      'Bescheid für 2025 über Einkommensteuer',
      'Einkommensteuerbescheid',
      'Steuernummer: 000/000/00000',
      'Veranlagungszeitraum: 2025',
      'Zu versteuerndes Einkommen: 32.500 €',
      'Festgesetzte Einkommensteuer: 6.120 €',
    ],
  },
};

/** A Dutch bill: a Latin-script language the classifier does not cover. */
export const UNCOVERED_LANGUAGE_SAMPLE: readonly LineSpec[] = [
  'WATERBEDRIJF UTOPIA',
  'Uw factuur over het derde kwartaal',
  'Te betalen bedrag 48,20',
  'Klantnummer 4471',
  'Meterstand 1222',
];

/** A bill in Cyrillic script. */
export const OTHER_SCRIPT_SAMPLE: readonly LineSpec[] = [
  'ВОДОКАНАЛ УТОПИИ',
  'Счёт за воду',
  'Сумма к оплате 48,20',
  'Лицевой счёт 4471',
];

/** A passport's data page (an invented Utopian passport, MRZ included). */
export const PASSPORT_SAMPLE: readonly LineSpec[] = [
  'UTOPIA',
  'PASSPORT / PASSEPORT',
  'Surname / Nom',
  'VALEMONT',
  'Given names / Prénoms',
  'QUINN',
  'Nationality / Nationalité',
  'UTOPIAN',
  'Date of birth / Date de naissance',
  '12 APR 1987',
  'P<UTOVALEMONT<<QUINN<<<<<<<<<<<<<<<<<<<<<<<<',
  'X000000000UTO8704122F3001017<<<<<<<<<<<<<<00',
];

/** A plain letter: covered words, no class evidence. */
export const LETTER_SAMPLE: readonly LineSpec[] = [
  'Dear Quinn,',
  'Thank you for your visit to the library this week.',
  'We look forward to seeing you again with your family.',
  'With best wishes from the reading room team',
];
