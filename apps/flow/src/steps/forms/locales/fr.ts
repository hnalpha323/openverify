import type { Widen } from '../../../i18n/locales/en';
import type { formsEn } from './en';

/**
 * French messages of the steps the user fills in (C52.3, C64.1). Machine-drafted by the build
 * agents (C161.5). Examples (`name@example.com`, `https://www.example.com`, `YYYY-MM-DD`) are the
 * formats the fields accept and stay as written.
 */
export const formsFr: Widen<typeof formsEn> = {
  requiredNote: 'Les champs marqués d’un * sont obligatoires.',
  continue: 'Continuer',
  sending: 'Envoi de vos informations…',
  received:
    'Nous avons reçu vos informations. Envoyez-les pour vérification, ou modifiez-les ci-dessous.',
  sendReceived: 'Envoyer pour vérification',
  invalid: 'Vérifiez les informations signalées ci-dessous.',
  refused: 'Certaines informations n’ont pas été acceptées. Vérifiez-les et réessayez.',
  address: 'Adresse',
  chooseCountry: 'Choisissez un pays',
  chooseState: 'Choisissez un État ou un territoire',
  database: {
    title: 'Saisissez vos informations',
    intro:
      'Nous vérifions ces informations auprès de registres officiels. Saisissez-les telles qu’elles figurent sur vos documents officiels.',
  },
  database_business: {
    title: 'Parlez-nous de votre entreprise',
    intro:
      'Nous recherchons ces informations dans les registres officiels des entreprises. Saisissez-les telles que l’entreprise est immatriculée.',
  },
  business_website: {
    title: 'Saisissez le site web de votre entreprise',
    intro:
      'Nous vérifions que l’adresse du site web existe. Nous n’ouvrons jamais le site lui-même.',
  },
  businessAddress: 'Adresse du siège',
  persons: {
    legend: 'Personnes qui possèdent ou dirigent l’entreprise',
    intro:
      'Vous pouvez ajouter jusqu’à {{max}} dirigeants, mandataires ou propriétaires à vérifier dans le registre.',
    person: 'Personne {{number}}',
    add: 'Ajouter une personne',
    remove: 'Retirer la personne {{number}}',
    full: 'Vous avez ajouté le nombre maximal de personnes.',
  },
  aamva: {
    title: 'Saisissez les informations de votre permis de conduire',
    intro:
      'Saisissez les informations exactement comme elles sont imprimées sur votre permis de conduire américain ou votre carte d’identité d’État. Nous les vérifions auprès de l’administration qui l’a délivré.',
  },
  silent: {
    title: 'Vérification de votre permis',
    message:
      'Nous vérifions votre permis de conduire ou votre carte d’identité auprès de l’administration qui l’a délivré. Cela prend généralement quelques secondes. Gardez cette page ouverte.',
  },
  fields: {
    'name-first': 'Prénom',
    'name-middle': 'Deuxième prénom',
    'name-last': 'Nom de famille',
    birthdate: 'Date de naissance',
    'address-street-1': 'Ligne d’adresse 1',
    'address-street-2': 'Ligne d’adresse 2',
    'address-city': 'Ville',
    'address-subdivision': 'État, province ou région',
    'address-postal-code': 'Code postal',
    'address-country-code': 'Pays',
    'identification-number': 'Numéro d’identification',
    'phone-number': 'Numéro de téléphone',
    'email-address': 'Adresse e-mail',
    licenseNumber: 'Numéro du permis de conduire ou de la carte d’identité',
    issuingAuthority: 'État ou territoire de délivrance',
    issueDate: 'Date de délivrance',
    expirationDate: 'Date d’expiration',
    zip: 'Code ZIP',
    'business-name': 'Nom de l’entreprise',
    'country-code': 'Pays d’immatriculation',
    'registration-number': 'Numéro d’immatriculation',
    lei: 'Identifiant d’entité juridique (LEI)',
    businessStreet1: 'Ligne d’adresse 1',
    businessStreet2: 'Ligne d’adresse 2',
    businessCity: 'Ville',
    businessSubdivision: 'État, province ou région',
    businessPostalCode: 'Code postal',
    'person-name-first': 'Prénom',
    'person-name-last': 'Nom de famille',
    'person-birthdate': 'Mois ou date de naissance',
    'website-url': 'Adresse du site web',
  },
  hints: {
    'phone-number': 'Indiquez l’indicatif de votre pays.',
    registrationGb:
      'Pour une société britannique, le numéro Companies House à 8 caractères, par exemple 01234567 ou SC123456.',
    registrationUs: 'Pour une société américaine, son numéro CIK de la SEC, jusqu’à 10 chiffres.',
    registration:
      'Le numéro attribué à l’entreprise par le registre : jusqu’à 20 lettres et chiffres.',
    lei: 'Le code à 20 caractères du registre mondial des LEI. Laissez vide si l’entreprise n’en a pas.',
    'person-birthdate': 'Au format YYYY-MM ou YYYY-MM-DD.',
    'website-url': 'Indiquez https:// ou http://, par exemple https://www.example.com.',
  },
  required: {
    'name-first': 'Saisissez votre prénom.',
    'name-middle': 'Saisissez votre deuxième prénom.',
    'name-last': 'Saisissez votre nom de famille.',
    birthdate: 'Saisissez votre date de naissance.',
    'address-street-1': 'Saisissez la première ligne de votre adresse.',
    'address-street-2': 'Saisissez la deuxième ligne de votre adresse.',
    'address-city': 'Saisissez votre ville.',
    'address-subdivision': 'Saisissez votre État, province ou région.',
    'address-postal-code': 'Saisissez votre code postal.',
    'address-country-code': 'Choisissez votre pays.',
    'identification-number': 'Saisissez votre numéro d’identification.',
    'phone-number': 'Saisissez votre numéro de téléphone.',
    'email-address': 'Saisissez votre adresse e-mail.',
    licenseNumber: 'Saisissez le numéro de votre permis ou de votre carte d’identité.',
    issuingAuthority: 'Choisissez l’État ou le territoire qui l’a délivré.',
    issueDate: 'Saisissez la date de délivrance.',
    expirationDate: 'Saisissez la date d’expiration.',
    zip: 'Saisissez votre code ZIP.',
    'business-name': 'Saisissez le nom de l’entreprise.',
    'country-code': 'Choisissez le pays où l’entreprise est immatriculée.',
    'registration-number': 'Saisissez le numéro d’immatriculation.',
    lei: 'Saisissez le LEI.',
    businessStreet1: 'Saisissez la première ligne de l’adresse de l’entreprise.',
    businessStreet2: 'Saisissez la deuxième ligne de l’adresse de l’entreprise.',
    businessCity: 'Saisissez la ville de l’entreprise.',
    businessSubdivision: 'Saisissez l’État, la province ou la région de l’entreprise.',
    businessPostalCode: 'Saisissez le code postal de l’entreprise.',
    'person-name-first': 'Saisissez le prénom de cette personne.',
    'person-name-last': 'Saisissez le nom de famille de cette personne.',
    'person-birthdate': 'Saisissez le mois ou la date de naissance de cette personne.',
    'website-url': 'Saisissez l’adresse du site web.',
  },
  errors: {
    tooLong: 'Saisissez au maximum {{max}} caractères.',
    date: 'Saisissez une date réelle.',
    phone: 'Saisissez le numéro avec son indicatif de pays, par exemple +1 202 555 0143.',
    email: 'Saisissez une adresse e-mail au bon format, par exemple name@example.com.',
    zip: 'Saisissez un code ZIP à 5 chiffres, ou un ZIP+4 comme 12345-6789.',
    url: 'Saisissez l’adresse web complète, commençant par https:// ou http://, par exemple https://www.example.com.',
    lei: 'Saisissez le LEI à 20 caractères exactement tel qu’il est enregistré.',
    registrationGb:
      'Saisissez le numéro de société à 8 caractères, par exemple 01234567 ou SC123456.',
    registrationUs: 'Saisissez le CIK : jusqu’à 10 chiffres.',
    registration: 'Saisissez jusqu’à 20 lettres et chiffres, sans espaces.',
    birthMonth: 'Saisissez le mois au format YYYY-MM, ou la date au format YYYY-MM-DD.',
    refused: 'Cette valeur n’a pas été acceptée. Vérifiez-la et réessayez.',
  },
};
