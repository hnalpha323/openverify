import type { Widen } from '../../i18n/locales/en';
import type { screenEn } from './en';

/**
 * Spanish messages of the screen step and the server-position screens (C148.7, C150.5, C151.2,
 * C158.5, C171.4). Machine-drafted by the build agents (C161.5): the person is addressed as
 * « usted », with no gendered agreement.
 */
export const screenEs: Widen<typeof screenEn> = {
  continue: 'Continuar',
  heading: 'Sus datos',
  required: 'Los campos marcados con * son obligatorios.',
  choose: 'Elija…',
  set: 'Ya proporcionado. Escriba un valor nuevo para cambiarlo.',
  summary: 'Revise estas respuestas:',
  errors: {
    required: 'Introduzca o elija un valor.',
    tooShort: 'Introduzca al menos {{limit}} caracteres.',
    tooLong: 'Introduzca como máximo {{limit}} caracteres.',
    pattern: 'No tiene el formato esperado.',
    number: 'Introduzca un número.',
    tooSmall: 'Introduzca {{limit}} o más.',
    tooLarge: 'Introduzca {{limit}} o menos.',
    date: 'Introduzca una fecha.',
    dateTooEarly: 'Introduzca {{limit}} o una fecha posterior.',
    dateTooLate: 'Introduzca {{limit}} o una fecha anterior.',
    email: 'Introduzca una dirección de correo electrónico, como nombre@example.com.',
    phone: 'Introduzca un número de teléfono con su prefijo internacional.',
    url: 'Introduzca una dirección web que empiece por https://.',
    option: 'Elija una de las opciones.',
    country: 'Elija uno de los países.',
    refused: 'No se aceptó este valor. Revíselo e inténtelo de nuevo.',
  },
  address: {
    street1: 'Dirección',
    street2: 'Piso, puerta o edificio (opcional)',
    city: 'Ciudad',
    subdivision: 'Estado, provincia o región',
    postalCode: 'Código postal',
    country: 'País',
  },
  saving: 'Guardando sus respuestas…',
  cancel: {
    title: '¿Desea parar por ahora?',
    message: 'Se conservan sus respuestas. Puede volver con el mismo enlace para continuar.',
    confirm: 'Sí, parar por ahora',
    keep: 'No, continuar',
    stopped: 'Ha parado por ahora',
    stoppedMessage: 'Puede volver con el mismo enlace para continuar donde lo dejó.',
  },
  unavailable: 'Esta pantalla no se puede mostrar en esta versión.',
  help: 'Ayuda y privacidad',
  helpLink: 'Obtener ayuda',
  privacyLink: 'Aviso de privacidad',
  waiting: {
    title: 'Un momento',
    message: 'Estamos preparando el siguiente paso…',
  },
  halted: {
    title: 'Esta verificación no puede continuar',
    message:
      'Algo impidió que esta verificación continuara. Póngase en contacto con la organización que le pidió verificarse.',
  },
  redirect: {
    announce: 'Ha terminado su parte. Use Continuar para volver al sitio web del que vino.',
    continue: 'Continuar',
  },
  extend: {
    warning: 'Quedan unos {{seconds}} segundos para hacer sus fotos. ¿Necesita más tiempo?',
    button: 'Más tiempo',
    extended: 'Tiene más tiempo.',
    failed:
      'No pudimos añadir más tiempo. Haga sus fotos ahora, o empiece de nuevo si se acaba el tiempo.',
  },
};
