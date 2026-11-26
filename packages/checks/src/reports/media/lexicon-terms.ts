/**
 * C81.3: the authored terms of the adverse-media lexicon, per category and language (OpenVerify's
 * own lists, written for this lexicon). A trailing `*` lets a German single-word term match the
 * compounds it begins; elsewhere terms are matched as whole words. Kept apart from the matcher so
 * a review reads the words alone.
 */
import type { AdverseMediaCategory } from '@openverify/core';

/** The terms of one category: English, Spanish, French and German. */
export interface CategoryTerms {
  readonly en: readonly string[];
  readonly es: readonly string[];
  readonly fr: readonly string[];
  readonly de: readonly string[];
}

const FINANCIAL_CRIME: CategoryTerms = {
  en: [
    'financial crime',
    'embezzlement',
    'embezzled',
    'embezzling',
    'insider trading',
    'market manipulation',
    'tax evasion',
    'misappropriation',
    'misappropriated',
    'ponzi',
  ],
  es: [
    'delito financiero',
    'delitos financieros',
    'malversación',
    'evasión fiscal',
    'evasión de impuestos',
    'información privilegiada',
    'manipulación del mercado',
    'ponzi',
  ],
  fr: [
    'délit financier',
    'délits financiers',
    'détournement de fonds',
    'abus de biens sociaux',
    'délit d’initié',
    'évasion fiscale',
    'fraude fiscale',
    'manipulation de marché',
    'ponzi',
  ],
  de: [
    'Finanzkriminalität',
    'Wirtschaftskriminalität',
    'Veruntreuung*',
    'Unterschlagung*',
    'Insiderhandel*',
    'Steuerhinterziehung*',
    'Marktmanipulation*',
    'Schneeballsystem*',
  ],
};

const FRAUD: CategoryTerms = {
  en: [
    'fraud',
    'frauds',
    'fraudulent',
    'fraudster',
    'fraudsters',
    'defrauded',
    'defrauding',
    'scam',
    'scams',
    'scammer',
    'scammers',
    'swindle',
    'swindled',
    'swindler',
    'forgery',
    'counterfeit',
    'counterfeiting',
  ],
  es: [
    'fraude',
    'fraudes',
    'fraudulento',
    'fraudulenta',
    'estafa',
    'estafas',
    'estafador',
    'estafadores',
    'falsificación',
  ],
  fr: [
    'fraude',
    'fraudes',
    'frauduleux',
    'frauduleuse',
    'escroquerie',
    'escroqueries',
    'escroc',
    'escrocs',
    'arnaque',
    'contrefaçon',
  ],
  de: ['Betrug', 'Betrugs*', 'Betrüger*', 'betrügerisch*', 'Fälschung*', 'Urkundenfälschung*'],
};

const CORRUPTION: CategoryTerms = {
  en: ['corruption', 'corrupt', 'bribery', 'bribe', 'bribes', 'bribed', 'kickback', 'kickbacks'],
  es: ['corrupción', 'corrupto', 'corrupta', 'soborno', 'sobornos', 'cohecho', 'coima', 'coimas'],
  fr: [
    'corruption',
    'corrompu',
    'corrompue',
    'pot-de-vin',
    'pots-de-vin',
    'trafic d’influence',
    'prise illégale d’intérêts',
  ],
  de: ['korrupt*', 'Bestechung*', 'bestochen', 'Bestechlichkeit', 'Schmiergeld*', 'Vorteilsnahme'],
};

const MONEY_LAUNDERING: CategoryTerms = {
  en: ['money laundering', 'laundering', 'launder', 'laundered', 'launderer'],
  es: ['blanqueo de capitales', 'blanqueo de dinero', 'lavado de dinero', 'lavado de activos'],
  fr: ['blanchiment', 'blanchiment d’argent', 'blanchiment de capitaux'],
  de: ['Geldwäsche*', 'Geldwäscher*', 'Schwarzgeld*'],
};

const TERRORISM: CategoryTerms = {
  en: [
    'terrorism',
    'terrorist',
    'terrorists',
    'terror financing',
    'terrorist financing',
    'extremist',
    'extremists',
    'jihadist',
  ],
  es: ['terrorismo', 'terrorista', 'terroristas', 'financiación del terrorismo', 'yihadista'],
  fr: ['terrorisme', 'terroriste', 'terroristes', 'financement du terrorisme', 'djihadiste'],
  de: ['Terrorismus*', 'Terrorist*', 'Terrorfinanzierung*', 'Dschihadist*', 'Extremist*'],
};

const ORGANISED_CRIME: CategoryTerms = {
  en: [
    'organised crime',
    'organized crime',
    'mafia',
    'cartel',
    'cartels',
    'racketeering',
    'gangster',
    'crime syndicate',
    'crime boss',
    'human trafficking',
    'people smuggling',
  ],
  es: [
    'crimen organizado',
    'delincuencia organizada',
    'mafia',
    'cártel',
    'cárteles',
    'banda criminal',
    'trata de personas',
  ],
  fr: [
    'crime organisé',
    'criminalité organisée',
    'mafia',
    'bande organisée',
    'racket',
    'traite des êtres humains',
  ],
  de: [
    'organisierte Kriminalität',
    'Mafia*',
    'Bandenkriminalität',
    'Schutzgelderpressung*',
    'Menschenhandel*',
    'Schleuser*',
  ],
};

const NARCOTICS: CategoryTerms = {
  en: [
    'drug trafficking',
    'drug trafficker',
    'drug smuggling',
    'drug dealer',
    'drug dealing',
    'drug cartel',
    'narcotics',
    'cocaine',
    'heroin',
    'fentanyl',
    'methamphetamine',
  ],
  es: [
    'narcotráfico',
    'narcotraficante',
    'narcotraficantes',
    'tráfico de drogas',
    'tráfico de estupefacientes',
    'cocaína',
    'heroína',
    'fentanilo',
  ],
  fr: [
    'trafic de drogue',
    'trafic de stupéfiants',
    'stupéfiants',
    'trafiquant de drogue',
    'narcotrafic',
    'cocaïne',
    'héroïne',
  ],
  de: [
    'Drogenhandel*',
    'Drogenschmuggel*',
    'Drogendealer*',
    'Drogenkartell*',
    'Rauschgift*',
    'Betäubungsmittel*',
    'Kokain*',
    'Heroin*',
  ],
};

const VIOLENT_CRIME: CategoryTerms = {
  en: [
    'murder',
    'murdered',
    'murderer',
    'homicide',
    'manslaughter',
    'assassination',
    'kidnapping',
    'kidnapped',
    'abduction',
    'armed robbery',
    'stabbing',
  ],
  es: ['asesinato', 'homicidio', 'secuestro', 'secuestrador', 'agresión', 'robo a mano armada'],
  fr: [
    'meurtre',
    'meurtrier',
    'homicide',
    'assassinat',
    'enlèvement',
    'séquestration',
    'agression',
    'vol à main armée',
  ],
  de: [
    'Mord*',
    'Mörder*',
    'Totschlag*',
    'Entführung*',
    'entführt',
    'Körperverletzung*',
    'Raubüberfall*',
    'Geiselnahme*',
  ],
};

const CYBERCRIME: CategoryTerms = {
  en: [
    'cybercrime',
    'cyber crime',
    'hacking',
    'hacker',
    'hackers',
    'ransomware',
    'phishing',
    'identity theft',
    'cyberattack',
  ],
  es: [
    'ciberdelito',
    'ciberdelincuencia',
    'ciberdelincuente',
    'pirata informático',
    'ransomware',
    'robo de identidad',
    'suplantación de identidad',
  ],
  fr: [
    'cybercriminalité',
    'cybercriminel',
    'piratage informatique',
    'pirate informatique',
    'rançongiciel',
    'hameçonnage',
    'usurpation d’identité',
  ],
  de: [
    'Cyberkriminalität*',
    'Cyberkriminelle*',
    'Hackerangriff*',
    'Erpressungstrojaner*',
    'Phishing*',
    'Identitätsdiebstahl*',
  ],
};

const PROPERTY_CRIME: CategoryTerms = {
  en: [
    'theft',
    'thefts',
    'burglary',
    'burglar',
    'robbery',
    'stolen goods',
    'arson',
    'looting',
    'shoplifting',
  ],
  es: ['robo', 'robos', 'hurto', 'hurtos', 'incendio provocado', 'saqueo', 'receptación'],
  fr: ['cambriolage', 'cambrioleur', 'incendie criminel', 'pillage', 'recel', 'vol qualifié'],
  de: ['Diebstahl*', 'Raubzug*', 'Brandstiftung*', 'Plünderung*', 'Hehlerei*'],
};

const REGULATORY: CategoryTerms = {
  en: [
    'fined',
    'sanctioned',
    'sanctions violation',
    'sanctions breach',
    'enforcement action',
    'disqualified',
    'licence revoked',
    'license revoked',
    'cease and desist',
  ],
  es: [
    'multado',
    'multada',
    'multa',
    'sancionado',
    'sancionada',
    'inhabilitado',
    'inhabilitada',
    'expediente sancionador',
  ],
  fr: [
    'amende',
    'sanctionné',
    'sanctionnée',
    'interdiction d’exercer',
    'radié',
    'radiée',
    'mise en demeure',
  ],
  de: ['Geldbuße*', 'Bußgeld*', 'sanktioniert*', 'Berufsverbot*', 'Lizenzentzug*', 'Strafzahlung*'],
};

const FINANCIAL_DIFFICULTY: CategoryTerms = {
  en: [
    'bankruptcy',
    'bankrupt',
    'insolvency',
    'insolvent',
    'liquidation',
    'receivership',
    'foreclosure',
    'defaulted',
  ],
  es: [
    'quiebra',
    'bancarrota',
    'insolvencia',
    'insolvente',
    'concurso de acreedores',
    'suspensión de pagos',
  ],
  fr: [
    'faillite',
    'insolvabilité',
    'insolvable',
    'liquidation judiciaire',
    'redressement judiciaire',
    'cessation de paiements',
  ],
  de: ['Insolvenz*', 'Konkurs*', 'Pleite*', 'zahlungsunfähig*', 'Zahlungsunfähigkeit*'],
};

/** Every category's terms. */
export const LEXICON_TERMS: Readonly<Record<AdverseMediaCategory, CategoryTerms>> = {
  financial_crime: FINANCIAL_CRIME,
  fraud: FRAUD,
  corruption: CORRUPTION,
  money_laundering: MONEY_LAUNDERING,
  terrorism: TERRORISM,
  organised_crime: ORGANISED_CRIME,
  narcotics: NARCOTICS,
  violent_crime: VIOLENT_CRIME,
  cybercrime: CYBERCRIME,
  property_crime: PROPERTY_CRIME,
  regulatory: REGULATORY,
  financial_difficulty: FINANCIAL_DIFFICULTY,
};
