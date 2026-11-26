import type { Widen } from '../../i18n/locales/en';
import type { handoffEn } from './en';

/** Spanish messages of device handoff (C96.5). */
export const handoffEs: Widen<typeof handoffEn> = {
  desktop: {
    title: 'Continúa en tu teléfono',
    intro:
      'Escanea este código con la cámara de tu teléfono para continuar esta verificación en él. Lo que ya hiciste aquí se conserva.',
    issuing: 'Obteniendo un código para tu teléfono…',
    qrLabel: 'Código QR que abre esta verificación en tu teléfono',
    linkLabel: 'O abre este enlace en tu teléfono',
    copy: 'Copiar enlace',
    copied: 'Enlace copiado.',
    expiresIn: 'Este código caduca en {{time}}.',
    expired: 'Este código ha caducado. Obtén uno nuevo para continuar en tu teléfono.',
    newCode: 'Obtener un código nuevo',
    confirmationCode: 'Cuando tu teléfono pida un código, escribe: {{code}}',
    emailOption: 'Enviar un enlace por correo electrónico',
    smsOption: 'Enviar un enlace por SMS',
    emailLabel: 'Correo electrónico',
    smsLabel: 'Número de teléfono, con su prefijo internacional',
    smsHint: 'Por ejemplo +34 600 000 000.',
    send: 'Enviar enlace',
    sending: 'Enviando el enlace…',
    sentEmail:
      'Te enviamos un enlace a tu correo electrónico. Ábrelo en tu teléfono en los próximos {{minutes}} minutos.',
    sentSms: 'Te enviamos un enlace por SMS. Ábrelo en los próximos {{minutes}} minutos.',
    showQr: 'Mostrar un código QR',
    continueHere: 'Continuar en este dispositivo',
    continuing: 'Continuando en este dispositivo…',
    waitingTitle: 'Continuando en tu teléfono',
    waiting:
      'Continuaste en tu teléfono a las {{time}}. Termina la verificación allí; esta página se actualiza cuando acabes.',
    waitingDevice: 'Tu teléfono: {{device}}',
    notMe: 'No fui yo',
    rejecting: 'Cerrando la sesión del otro dispositivo…',
    rejected:
      'Cerramos la sesión del otro dispositivo y cancelamos lo que no había terminado. Obtén un código nuevo o continúa aquí.',
    declined: 'El otro dispositivo rechazó continuar. Obtén un código nuevo o continúa aquí.',
    errors: {
      destinationNotConfirmed:
        'Solo podemos enviar un enlace a un correo o teléfono que confirmaste antes en esta verificación.',
      sendLimited: 'Se enviaron demasiados enlaces. Espera un rato o usa el código QR.',
      required: 'Indica a dónde enviar el enlace.',
    },
  },
  phone: {
    title: 'Continúa tu verificación',
    loading: 'Comprobando tu enlace…',
    requester: '{{organization}} te pidió verificar tu identidad.',
    verifies: 'En este teléfono se te pedirá:',
    started: 'Esta verificación se inició en otro dispositivo a las {{time}}.',
    startedIn: 'Esta verificación se inició en otro dispositivo en {{country}} a las {{time}}.',
    adviceQr:
      'Continúa solo si acabas de escanear este código en el sitio web de {{organization}}. Si alguien te envió este código, recházalo.',
    adviceLink:
      'Continúa solo si acabas de pedir este enlace en el sitio web de {{organization}}. Si no fue así, recházalo.',
    codeLabel: 'Código que aparece en tu otro dispositivo',
    codeHint: 'Seis dígitos.',
    codeRequired: 'Escribe el código de seis dígitos que aparece en tu otro dispositivo.',
    checkCode: 'Comprobar código',
    checking: 'Comprobando el código…',
    continue: 'Continuar',
    continuing: 'Abriendo tu verificación…',
    decline: 'Rechazar',
    declining: 'Rechazando…',
    declinedTitle: 'Rechazaste continuar',
    declined: 'No se compartió nada desde este teléfono. Puedes cerrar esta página.',
    invalid:
      'Este enlace no es válido, caducó o ya se usó. Vuelve al dispositivo donde empezaste para obtener un código nuevo.',
    limitTitle: 'Esta verificación no puede continuar aquí',
    limit:
      'Esta verificación no puede continuar en otro dispositivo. Vuelve al dispositivo donde empezaste.',
  },
  steps: {
    form: 'algunos datos sobre ti',
    government_id: 'una foto de tu documento de identidad',
    selfie: 'un selfie',
    document: 'subir un documento',
    phone_otp: 'un código enviado a tu teléfono',
    email_otp: 'un código enviado a tu correo electrónico',
    database: 'una comprobación de tus datos en una base de datos',
    aamva: 'una comprobación de tu permiso de conducir con su emisor',
    nfc: 'leer el chip de tu documento de identidad',
    crypto_wallet: 'demostrar que controlas una cartera de criptomonedas',
    database_business: 'una comprobación de tu empresa en registros mercantiles',
    business_website: 'una comprobación del sitio web de tu empresa',
  },
};
