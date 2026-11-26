/**
 * National identification number checksums (C33), for `id_number_format_inconsistency_detection`
 * on MRZ documents whose issuer has one. Each rule is written by OpenVerify from its published
 * algorithm; the source is cited per rule.
 *
 * A rule applies only to a value of its shape (`shape`, after `normalize`): the issuer may print
 * another number in the same field (a document number, an older format), and a value of another
 * shape falls back to the ICAO document number rules. A value of the rule's shape must then pass
 * its checksum.
 */
export interface NationalIdRule {
  id: string;
  /** ICAO three-letter code of the issuing state. */
  issuer: string;
  /** The C31.5 field the number sits in on the issuer's documents. */
  field: 'personal-number' | 'identification-number';
  description: string;
  /** The rule's shape, tested on the normalized value. */
  shape: RegExp;
  /** Upper-cases and removes the separators the issuer prints. */
  normalize: (value: string) => string;
  /** The value has the rule's shape and passes its checksum. */
  isValid: (value: string) => boolean;
  source: { citation: string; url: string };
}

const digits = (value: string): number[] => Array.from(value, Number);

const weightedSum = (values: readonly number[], weights: readonly number[]): number =>
  weights.reduce((sum, weight, index) => sum + weight * (values[index] ?? 0), 0);

/** Luhn: from the right, every second digit doubled (less 9 above 9); the sum is a multiple of 10. */
function luhnValid(value: string): boolean {
  let sum = 0;
  Array.from(value)
    .reverse()
    .forEach((char, index) => {
      let digit = Number(char);
      if (index % 2 === 1) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
    });
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

/** Verhoeff's dihedral-group check (the last digit is the check digit). */
function verhoeffValid(value: string): boolean {
  let check = 0;
  Array.from(value)
    .reverse()
    .forEach((char, index) => {
      check = VERHOEFF_D[check]?.[VERHOEFF_P[index % 8]?.[Number(char)] ?? 0] ?? 0;
    });
  return check === 0;
}

/** 11 - (sum mod 11), with 11 as 0; `null` for 10, which no valid number has. */
function mod11Complement(sum: number): number | null {
  const check = 11 - (sum % 11);
  if (check === 11) {
    return 0;
  }
  return check === 10 ? null : check;
}

const removeSeparators =
  (separators: RegExp) =>
  (value: string): string =>
    value.toUpperCase().replace(separators, '');

const SPACES = /\s+/g;
const SPACES_DOTS_HYPHENS = /[\s.-]+/g;

function rule(
  spec: Omit<NationalIdRule, 'isValid' | 'normalize'> & {
    normalize?: (value: string) => string;
    checksum: (normalized: string) => boolean;
  },
): NationalIdRule {
  const { checksum, normalize = removeSeparators(SPACES), ...rest } = spec;
  return Object.freeze({
    ...rest,
    normalize,
    isValid: (value: string) => {
      const normalized = normalize(value);
      return spec.shape.test(normalized) && checksum(normalized);
    },
  });
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const dniLetterValid = (number: string, letter: string): boolean =>
  DNI_LETTERS.charAt(Number(number) % 23) === letter;

/** Codice fiscale: the value of each character at an odd (1-based) position. */
const CF_ODD: Readonly<Record<string, number>> = Object.fromEntries(
  Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', (char, index) => [
    char,
    [
      1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6,
      8, 12, 14, 16, 10, 22, 25, 24, 23,
    ][index] ?? 0,
  ]),
);
const cfEven = (char: string): number => (/\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65);

function codiceFiscaleValid(value: string): boolean {
  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    const char = value.charAt(index);
    sum += index % 2 === 0 ? (CF_ODD[char] ?? 0) : cfEven(char);
  }
  return String.fromCharCode(65 + (sum % 26)) === value.charAt(15);
}

function belgianValid(value: string): boolean {
  const check = Number(value.slice(9));
  const base = value.slice(0, 9);
  // Someone born from 2000 on has a 2 put in front of the nine digits.
  return 97 - (Number(base) % 97) === check || 97 - (Number(`2${base}`) % 97) === check;
}

const HETU_CHECKS = '0123456789ABCDEFHJKLMNPRSTUVWXY';

function norwegianValid(value: string): boolean {
  const values = digits(value);
  const k1 = mod11Complement(weightedSum(values, [3, 7, 6, 1, 8, 9, 4, 5, 2]));
  const k2 = mod11Complement(weightedSum(values, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]));
  return k1 === values[9] && k2 === values[10];
}

/** Cartão de Cidadão: letters count 10-35, and every second value from the right is doubled. */
function cartaoCidadaoValid(value: string): boolean {
  let sum = 0;
  Array.from(value)
    .reverse()
    .forEach((char, index) => {
      let number = /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 55;
      if (index % 2 === 1) {
        number *= 2;
        if (number > 9) {
          number -= 9;
        }
      }
      sum += number;
    });
  return sum % 10 === 0;
}

function cpfValid(value: string): boolean {
  if (/^(\d)\1{10}$/.test(value)) {
    return false;
  }
  const values = digits(value);
  const check = (length: number): number =>
    ((weightedSum(
      values,
      Array.from({ length }, (_, index) => length + 1 - index),
    ) *
      10) %
      11) %
    10;
  return check(9) === values[9] && check(10) === values[10];
}

function rutValid(value: string): boolean {
  const body = value.slice(0, -1);
  let sum = 0;
  Array.from(body)
    .reverse()
    .forEach((char, index) => {
      sum += Number(char) * (2 + (index % 6));
    });
  const check = 11 - (sum % 11);
  const expected = check === 11 ? '0' : check === 10 ? 'K' : String(check);
  return value.endsWith(expected);
}

function chineseValid(value: string): boolean {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return '10X98765432'.charAt(weightedSum(digits(value.slice(0, 17)), weights) % 11) === value.charAt(17);
}

/** Estonian and Lithuanian personal codes: two passes of weights, 0 when both give 10. */
function balticValid(value: string): boolean {
  const values = digits(value);
  let check = weightedSum(values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 1]) % 11;
  if (check === 10) {
    check = weightedSum(values, [3, 4, 5, 6, 7, 8, 9, 1, 2, 3]) % 11;
    if (check === 10) {
      check = 0;
    }
  }
  return check === values[10];
}

function turkishValid(value: string): boolean {
  const d = digits(value);
  const odd = (d[0] ?? 0) + (d[2] ?? 0) + (d[4] ?? 0) + (d[6] ?? 0) + (d[8] ?? 0);
  const even = (d[1] ?? 0) + (d[3] ?? 0) + (d[5] ?? 0) + (d[7] ?? 0);
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = (d.slice(0, 9).reduce((sum, digit) => sum + digit, 0) + tenth) % 10;
  return tenth === d[9] && eleventh === d[10];
}

function romanianValid(value: string): boolean {
  const values = digits(value);
  const remainder = weightedSum(values, [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]) % 11;
  return (remainder === 10 ? 1 : remainder) === values[12];
}

/** ISO 7064 MOD 11,10 (the Croatian OIB). */
function oibValid(value: string): boolean {
  let carry = 10;
  for (const digit of digits(value.slice(0, 10))) {
    carry = (carry + digit) % 10;
    if (carry === 0) {
      carry = 10;
    }
    carry = (carry * 2) % 11;
  }
  const check = 11 - carry;
  return (check === 10 ? 0 : check) === Number(value.charAt(10));
}

function kennitalaValid(value: string): boolean {
  const values = digits(value);
  return mod11Complement(weightedSum(values, [3, 2, 7, 6, 5, 4, 3, 2])) === values[8];
}

export const NATIONAL_ID_RULES: readonly NationalIdRule[] = Object.freeze([
  rule({
    id: 'es-dni',
    issuer: 'ESP',
    field: 'personal-number',
    description: 'Spanish DNI: eight digits and a control letter (number mod 23)',
    shape: /^\d{8}[A-Z]$/,
    checksum: (value) => dniLetterValid(value.slice(0, 8), value.charAt(8)),
    source: {
      citation: 'Ministerio del Interior (Spain), cálculo del dígito de control del NIF/NIE',
      url: 'https://www.interior.gob.es/opencms/es/servicios-al-ciudadano/tramites-y-gestiones/dni/calculo-del-digito-de-control-del-nif-nie/',
    },
  }),
  rule({
    id: 'es-nie',
    issuer: 'ESP',
    field: 'personal-number',
    description: 'Spanish NIE: X, Y or Z (as 0, 1, 2), seven digits and the DNI control letter',
    shape: /^[XYZ]\d{7}[A-Z]$/,
    checksum: (value) =>
      dniLetterValid(String('XYZ'.indexOf(value.charAt(0))) + value.slice(1, 8), value.charAt(8)),
    source: {
      citation: 'Ministerio del Interior (Spain), cálculo del dígito de control del NIF/NIE',
      url: 'https://www.interior.gob.es/opencms/es/servicios-al-ciudadano/tramites-y-gestiones/dni/calculo-del-digito-de-control-del-nif-nie/',
    },
  }),
  rule({
    id: 'it-codice-fiscale',
    issuer: 'ITA',
    field: 'personal-number',
    description:
      'Italian codice fiscale: 16 characters, the last a control letter from the odd and even position tables (homocode letters allowed in digit positions)',
    shape: /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/,
    checksum: codiceFiscaleValid,
    source: {
      citation:
        'Decreto del Ministro delle Finanze 23 dicembre 1976 (Italy), codice fiscale, carattere di controllo',
      url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/istanze/richiesta-ts_cf/informazioni-codificazione-pf',
    },
  }),
  rule({
    id: 'nl-bsn',
    issuer: 'NLD',
    field: 'personal-number',
    description: 'Dutch burgerservicenummer: nine digits passing the eleven test (weights 9 to 2, then -1)',
    shape: /^\d{9}$/,
    checksum: (value) =>
      !/^0+$/.test(value) && weightedSum(digits(value), [9, 8, 7, 6, 5, 4, 3, 2, -1]) % 11 === 0,
    source: {
      citation: 'Rijksoverheid (Netherlands), burgerservicenummer and its elfproef',
      url: 'https://www.rvig.nl/bsn',
    },
  }),
  rule({
    id: 'be-national-number',
    issuer: 'BEL',
    field: 'personal-number',
    description:
      'Belgian national register number: eleven digits, the last two 97 - (the first nine mod 97), with a 2 prefixed for births from 2000',
    shape: /^\d{11}$/,
    normalize: removeSeparators(SPACES_DOTS_HYPHENS),
    checksum: belgianValid,
    source: {
      citation: 'FPS Home Affairs (Belgium), National Register: the national number and its check',
      url: 'https://www.ibz.rrn.fgov.be/fr/registre-national/',
    },
  }),
  rule({
    id: 'pl-pesel',
    issuer: 'POL',
    field: 'personal-number',
    description: 'Polish PESEL: eleven digits, weights 1, 3, 7, 9 repeated, check (10 - sum mod 10) mod 10',
    shape: /^\d{11}$/,
    checksum: (value) => {
      const values = digits(value);
      return (10 - (weightedSum(values, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]) % 10)) % 10 === values[10];
    },
    source: {
      citation: 'Ustawa z dnia 24 września 2010 r. o ewidencji ludności (Poland), numer PESEL',
      url: 'https://www.gov.pl/web/gov/czym-jest-numer-pesel',
    },
  }),
  rule({
    id: 'se-personnummer',
    issuer: 'SWE',
    field: 'personal-number',
    description: 'Swedish personnummer: YYMMDD, a separator, three digits and a Luhn check digit',
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    shape: /^(?:\d{2})?\d{6}\d{4}$/,
    normalize: removeSeparators(/[\s+-]+/g),
    checksum: (value) => luhnValid(value.slice(-10)),
    source: {
      citation: 'Skatteverket (Sweden), Personnummer (SKV 704)',
      url: 'https://www.skatteverket.se/privat/folkbokforing/personnummerochsamordningsnummer.4.3810a01c150939e893f18c29.html',
    },
  }),
  rule({
    id: 'fi-hetu',
    issuer: 'FIN',
    field: 'personal-number',
    description:
      'Finnish personal identity code: DDMMYY, a century sign, three digits and a check character (number mod 31)',
    shape: /^\d{6}[-+A-FU-Y]\d{3}[0-9A-Y]$/,
    checksum: (value) =>
      HETU_CHECKS.charAt(Number(value.slice(0, 6) + value.slice(7, 10)) % 31) === value.charAt(10),
    source: {
      citation: 'Digital and Population Data Services Agency (Finland), the personal identity code',
      url: 'https://dvv.fi/en/personal-identity-code',
    },
  }),
  rule({
    id: 'no-fodselsnummer',
    issuer: 'NOR',
    field: 'personal-number',
    description: 'Norwegian fødselsnummer: eleven digits with two modulus 11 control digits',
    shape: /^\d{11}$/,
    checksum: norwegianValid,
    source: {
      citation: 'Skatteetaten (Norway), fødselsnummer',
      url: 'https://www.skatteetaten.no/person/folkeregister/fodsel-og-navnevalg/barn-fodt-i-norge/fodselsnummer/',
    },
  }),
  rule({
    id: 'pt-cartao-cidadao',
    issuer: 'PRT',
    field: 'identification-number',
    description:
      'Portuguese Cartão de Cidadão document number: civil number, its check digit, two version characters and a final check over the whole',
    shape: /^\d{9}[A-Z0-9]{2}\d$/,
    checksum: cartaoCidadaoValid,
    source: {
      citation:
        'Agência para a Modernização Administrativa (Portugal), validação do número de documento do Cartão de Cidadão',
      url: 'https://www.autenticacao.gov.pt/documents/20126/115760/Valida%C3%A7%C3%A3o+de+N%C3%BAmero+de+Documento+do+Cart%C3%A3o+de+Cidad%C3%A3o.pdf',
    },
  }),
  rule({
    id: 'br-cpf',
    issuer: 'BRA',
    field: 'personal-number',
    description: 'Brazilian CPF: nine digits and two modulus 11 check digits',
    shape: /^\d{11}$/,
    normalize: removeSeparators(SPACES_DOTS_HYPHENS),
    checksum: cpfValid,
    source: {
      citation: 'Receita Federal do Brasil, Cadastro de Pessoas Físicas (CPF), dígitos verificadores',
      url: 'https://www.gov.br/receitafederal/pt-br/assuntos/meu-cpf',
    },
  }),
  rule({
    id: 'cl-rut',
    issuer: 'CHL',
    field: 'personal-number',
    description: 'Chilean RUN/RUT: seven or eight digits and a modulus 11 check (K for 10)',
    shape: /^\d{7,8}[0-9K]$/,
    normalize: removeSeparators(SPACES_DOTS_HYPHENS),
    checksum: rutValid,
    source: {
      citation: 'Servicio de Impuestos Internos (Chile), RUT and its dígito verificador',
      url: 'https://www.sii.cl/servicios_online/1039-1182.html',
    },
  }),
  rule({
    id: 'za-id',
    issuer: 'ZAF',
    field: 'personal-number',
    description: 'South African identity number: thirteen digits with a Luhn check digit',
    shape: /^\d{13}$/,
    checksum: luhnValid,
    source: {
      citation: 'Department of Home Affairs (South Africa), Identification Act 68 of 1997, identity number',
      url: 'https://www.dha.gov.za/index.php/civic-services/identity-documents',
    },
  }),
  rule({
    id: 'in-aadhaar',
    issuer: 'IND',
    field: 'personal-number',
    description: 'Indian Aadhaar number: twelve digits, not starting with 0 or 1, with a Verhoeff check digit',
    shape: /^[2-9]\d{11}$/,
    checksum: verhoeffValid,
    source: {
      citation: 'Unique Identification Authority of India, the Aadhaar number',
      url: 'https://uidai.gov.in/en/my-aadhaar/about-your-aadhaar.html',
    },
  }),
  rule({
    id: 'cn-resident-id',
    issuer: 'CHN',
    field: 'personal-number',
    description:
      'Chinese resident identity number: seventeen digits and an ISO 7064 MOD 11-2 check character (X for 10)',
    shape: /^\d{17}[\dX]$/,
    checksum: chineseValid,
    source: {
      citation: 'GB 11643-1999, Citizen identification number (ISO 7064:1983 MOD 11-2)',
      url: 'https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=080D6FBF2BB468F9007657F26D60013E',
    },
  }),
  rule({
    id: 'ee-isikukood',
    issuer: 'EST',
    field: 'personal-number',
    description: 'Estonian personal code: eleven digits, the last from two passes of weights mod 11',
    shape: /^[1-8]\d{10}$/,
    checksum: balticValid,
    source: {
      citation: 'EVS 585:2007, Personal code. Structure (Estonia)',
      url: 'https://www.siseministeerium.ee/en/personal-identification-code',
    },
  }),
  rule({
    id: 'lt-asmens-kodas',
    issuer: 'LTU',
    field: 'personal-number',
    description: 'Lithuanian personal code: the Estonian structure and check',
    shape: /^[1-8]\d{10}$/,
    checksum: balticValid,
    source: {
      citation: 'Gyventojų registras (Lithuania), asmens kodas and its control digit',
      url: 'https://www.registrucentras.lt/p/1121',
    },
  }),
  rule({
    id: 'tr-kimlik',
    issuer: 'TUR',
    field: 'personal-number',
    description: 'Turkish identity number: eleven digits, the last two derived from the first nine',
    shape: /^[1-9]\d{10}$/,
    checksum: turkishValid,
    source: {
      citation: 'Nüfus ve Vatandaşlık İşleri Genel Müdürlüğü (Türkiye), T.C. kimlik numarası',
      url: 'https://www.nvi.gov.tr/',
    },
  }),
  rule({
    id: 'ro-cnp',
    issuer: 'ROU',
    field: 'personal-number',
    description: 'Romanian CNP: thirteen digits, the last from the key 279146358279 mod 11 (10 as 1)',
    shape: /^[1-9]\d{12}$/,
    checksum: romanianValid,
    source: {
      citation: 'Direcția pentru Evidența Persoanelor (Romania), codul numeric personal',
      url: 'https://depabd.mai.gov.ro/',
    },
  }),
  rule({
    id: 'hr-oib',
    issuer: 'HRV',
    field: 'personal-number',
    description: 'Croatian OIB: eleven digits with an ISO 7064 MOD 11,10 check digit',
    shape: /^\d{11}$/,
    checksum: oibValid,
    source: {
      citation: 'Zakon o osobnom identifikacijskom broju (Croatia, NN 60/08), ISO 7064 MOD 11,10',
      url: 'https://www.porezna-uprava.hr/HR_OIB/Stranice/default.aspx',
    },
  }),
  rule({
    id: 'is-kennitala',
    issuer: 'ISL',
    field: 'personal-number',
    description:
      'Icelandic kennitala: ten digits, the ninth a modulus 11 check over the first eight, the tenth the century (9, 0 or 8)',
    shape: /^\d{9}[089]$/,
    normalize: removeSeparators(SPACES_DOTS_HYPHENS),
    checksum: kennitalaValid,
    source: {
      citation: 'Registers Iceland (Þjóðskrá), the kennitala',
      url: 'https://www.skra.is/english/people/my-registration/id-number/',
    },
  }),
]);

/** The rules of an issuing state (ICAO three-letter code), in table order. */
export function nationalIdRulesFor(issuer: string): readonly NationalIdRule[] {
  return NATIONAL_ID_RULES.filter((candidate) => candidate.issuer === issuer);
}
