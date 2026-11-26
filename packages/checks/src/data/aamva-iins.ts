/**
 * The issuer identification numbers (IINs) of the AAMVA member jurisdictions (C33): the six-digit
 * number at the start of every AAMVA PDF417 payload (Annex D, Table D.1), which names the
 * jurisdiction that issued the card. 72 IINs: 57 US (the states, DC, territories and the State
 * Department), 13 Canadian and 2 Mexican.
 *
 * Hand-curated by OpenVerify from the AAMVA IIN page: IINs are short factual identifiers, and the
 * page (© AAMVA) is not copied. Abbreviations are kept as the page lists them (Newfoundland stays
 * `NF`), except Colorado, which the page misprints as `GM`; names are spelled out correctly.
 */
export type AamvaCountry = 'US' | 'CA' | 'MX';

export interface AamvaIin {
  iin: string;
  jurisdiction: string;
  /** The jurisdiction's two-letter abbreviation; `null` for the State Department, which has none. */
  code: string | null;
  country: AamvaCountry;
}

export const AAMVA_IIN_SOURCE = Object.freeze({
  url: 'https://aamva.org/identity/issuer-identification-numbers-(iin)',
  retrieved: '2026-10-21',
  corrections: Object.freeze([
    '636020 (Colorado) is listed with the abbreviation GM; OpenVerify uses CO.',
  ]),
});

const iin = (
  number: string,
  jurisdiction: string,
  code: string | null,
  country: AamvaCountry,
): AamvaIin => Object.freeze({ iin: number, jurisdiction, code, country });

export const AAMVA_IINS: readonly AamvaIin[] = Object.freeze([
  iin('604426', 'Prince Edward Island', 'PE', 'CA'),
  iin('604427', 'American Samoa', 'AS', 'US'),
  iin('604428', 'Quebec', 'QC', 'CA'),
  iin('604429', 'Yukon', 'YT', 'CA'),
  iin('604430', 'Northern Mariana Islands', 'MP', 'US'),
  iin('604431', 'Puerto Rico', 'PR', 'US'),
  iin('604432', 'Alberta', 'AB', 'CA'),
  iin('604433', 'Nunavut', 'NU', 'CA'),
  iin('604434', 'Northwest Territories', 'NT', 'CA'),
  iin('636000', 'Virginia', 'VA', 'US'),
  iin('636001', 'New York', 'NY', 'US'),
  iin('636002', 'Massachusetts', 'MA', 'US'),
  iin('636003', 'Maryland', 'MD', 'US'),
  iin('636004', 'North Carolina', 'NC', 'US'),
  iin('636005', 'South Carolina', 'SC', 'US'),
  iin('636006', 'Connecticut', 'CT', 'US'),
  iin('636007', 'Louisiana', 'LA', 'US'),
  iin('636008', 'Montana', 'MT', 'US'),
  iin('636009', 'New Mexico', 'NM', 'US'),
  iin('636010', 'Florida', 'FL', 'US'),
  iin('636011', 'Delaware', 'DE', 'US'),
  iin('636012', 'Ontario', 'ON', 'CA'),
  iin('636013', 'Nova Scotia', 'NS', 'CA'),
  iin('636014', 'California', 'CA', 'US'),
  iin('636015', 'Texas', 'TX', 'US'),
  iin('636016', 'Newfoundland', 'NF', 'CA'),
  iin('636017', 'New Brunswick', 'NB', 'CA'),
  iin('636018', 'Iowa', 'IA', 'US'),
  iin('636019', 'Guam', 'GU', 'US'),
  iin('636020', 'Colorado', 'CO', 'US'),
  iin('636021', 'Arkansas', 'AR', 'US'),
  iin('636022', 'Kansas', 'KS', 'US'),
  iin('636023', 'Ohio', 'OH', 'US'),
  iin('636024', 'Vermont', 'VT', 'US'),
  iin('636025', 'Pennsylvania', 'PA', 'US'),
  iin('636026', 'Arizona', 'AZ', 'US'),
  iin('636027', 'State Department (diplomatic)', null, 'US'),
  iin('636028', 'British Columbia', 'BC', 'CA'),
  iin('636029', 'Oregon', 'OR', 'US'),
  iin('636030', 'Missouri', 'MO', 'US'),
  iin('636031', 'Wisconsin', 'WI', 'US'),
  iin('636032', 'Michigan', 'MI', 'US'),
  iin('636033', 'Alabama', 'AL', 'US'),
  iin('636034', 'North Dakota', 'ND', 'US'),
  iin('636035', 'Illinois', 'IL', 'US'),
  iin('636036', 'New Jersey', 'NJ', 'US'),
  iin('636037', 'Indiana', 'IN', 'US'),
  iin('636038', 'Minnesota', 'MN', 'US'),
  iin('636039', 'New Hampshire', 'NH', 'US'),
  iin('636040', 'Utah', 'UT', 'US'),
  iin('636041', 'Maine', 'ME', 'US'),
  iin('636042', 'South Dakota', 'SD', 'US'),
  iin('636043', 'District of Columbia', 'DC', 'US'),
  iin('636044', 'Saskatchewan', 'SK', 'CA'),
  iin('636045', 'Washington', 'WA', 'US'),
  iin('636046', 'Kentucky', 'KY', 'US'),
  iin('636047', 'Hawaii', 'HI', 'US'),
  iin('636048', 'Manitoba', 'MB', 'CA'),
  iin('636049', 'Nevada', 'NV', 'US'),
  iin('636050', 'Idaho', 'ID', 'US'),
  iin('636051', 'Mississippi', 'MS', 'US'),
  iin('636052', 'Rhode Island', 'RI', 'US'),
  iin('636053', 'Tennessee', 'TN', 'US'),
  iin('636054', 'Nebraska', 'NE', 'US'),
  iin('636055', 'Georgia', 'GA', 'US'),
  iin('636056', 'Coahuila', 'CU', 'MX'),
  iin('636057', 'Hidalgo', 'HL', 'MX'),
  iin('636058', 'Oklahoma', 'OK', 'US'),
  iin('636059', 'Alaska', 'AK', 'US'),
  iin('636060', 'Wyoming', 'WY', 'US'),
  iin('636061', 'West Virginia', 'WV', 'US'),
  iin('636062', 'Virgin Islands', 'VI', 'US'),
]);

const BY_IIN: ReadonlyMap<string, AamvaIin> = new Map(AAMVA_IINS.map((entry) => [entry.iin, entry]));

/** The jurisdiction of an IIN, or `null` for a number AAMVA does not list. */
export function aamvaIssuerOf(number: string): AamvaIin | null {
  return BY_IIN.get(number) ?? null;
}
