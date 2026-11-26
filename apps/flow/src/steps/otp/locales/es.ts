import type { Widen } from '../../../i18n/locales/en';
import type { otpEn } from './en';

/** Spanish messages of the phone and email one-time-code steps (C55, C64.1). */
export const otpEs: Widen<typeof otpEn> = {
  send: 'Enviar código',
  sending: 'Enviando tu código…',
  phone: {
    title: 'Confirma tu número de teléfono',
    intro:
      'Te enviaremos un código por SMS a tu teléfono. Pueden aplicarse las tarifas habituales de mensajes.',
    country: 'País',
    countryOption: '{{country}} ({{code}})',
    number: 'Número de teléfono',
    numberHint: 'Puedes omitir el prefijo del país.',
    change: 'Cambiar el número de teléfono',
    errors: {
      required: 'Escribe tu número de teléfono.',
      invalid: 'Escribe un número de teléfono válido para el país que elegiste.',
      notAllowed:
        'No se pueden enviar códigos a este número aquí. Usa un número de uno de los países de la lista.',
      destinationInvalid:
        'Este número no puede recibir un código. Revísalo o usa otro número de teléfono.',
      deliveryFailed:
        'No pudimos enviar un código a este número. Revísalo y vuelve a intentarlo, o usa otro número.',
    },
  },
  email: {
    title: 'Confirma tu correo electrónico',
    intro: 'Te enviaremos un código a tu dirección de correo electrónico.',
    address: 'Correo electrónico',
    change: 'Cambiar el correo electrónico',
    errors: {
      required: 'Escribe tu correo electrónico.',
      invalid: 'Escribe un correo electrónico con el formato correcto, como nombre@ejemplo.com.',
      notAllowed:
        'No se pueden enviar códigos a este correo electrónico aquí. Usa otra dirección de correo.',
      destinationInvalid:
        'Este correo electrónico no puede recibir un código. Revísalo o usa otra dirección de correo.',
      deliveryFailed:
        'No pudimos enviar un código a este correo electrónico. Revísalo y vuelve a intentarlo, o usa otra dirección de correo.',
    },
  },
  code: {
    title: 'Escribe el código',
    sentTo: 'Enviamos un código a {{destination}}.',
    sentAgain: 'Enviamos un código nuevo a {{destination}}.',
    label: 'Código',
    hint: 'El código tiene {{length}} dígitos.',
    confirm: 'Confirmar',
    checking: 'Comprobando tu código…',
    attemptsLeft: 'Intentos que quedan para este código: {{remaining}}',
    expiresAt: 'El código caduca a las {{time}}.',
    resend: 'Enviar un código nuevo',
    resendIn: 'Podrás pedir un código nuevo dentro de {{time}}.',
    resendReady: 'Ya puedes pedir un código nuevo.',
    noResend: 'No se pueden enviar más códigos.',
    expiredFinal:
      'Este código ha caducado y no se pueden enviar más códigos. Vuelve a empezar para recibir un código nuevo.',
    startAgain: 'Volver a empezar',
    errors: {
      required: 'Escribe el código que te enviamos.',
      format: 'Escribe el código de {{length}} dígitos.',
      incorrect: 'El código no es correcto. Revísalo y vuelve a intentarlo.',
      expired: 'Este código ha caducado. Pide un código nuevo.',
      exhausted: 'Demasiados intentos incorrectos con este código. Pide un código nuevo.',
      notSent: 'Primero pide un código.',
      tooSoon: 'Espera un poco antes de pedir un código nuevo.',
    },
  },
  limited: {
    title: 'Ahora no podemos enviarte un código',
    message:
      'No pudimos enviar ni comprobar un código en este momento. Puedes continuar, y la organización que te pidió la verificación la revisará.',
    continue: 'Continuar',
    continuing: 'Enviando tu verificación…',
    failed: 'No pudimos continuar. Espera un rato y vuelve a intentarlo.',
  },
  confirmed: {
    title: 'Tu código está confirmado',
    submitting: 'Enviando tu verificación…',
  },
};
