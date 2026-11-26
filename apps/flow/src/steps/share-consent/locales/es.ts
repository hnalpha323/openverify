import type { Widen } from '../../../i18n/locales/en';
import type { shareConsentEn } from './en';

/**
 * Spanish messages of the share-consent step (C238.6, C237.6). Machine-drafted by the build agents
 * (C161.5): the `consent` texts are legal texts, drafted and not reviewed, and pending counsel's
 * review in English (C238.10). Placeholders keep their `{{name}}` syntax; the server fills them.
 */
export const shareConsentEs: Widen<typeof shareConsentEn> = {
  consent: {
    title: 'Compartir sus datos verificados con {{recipient}}',
    source:
      '{{source}} le pide su acuerdo para compartir con {{recipient}} los datos que verificó sobre usted, para que {{recipient}} pueda reutilizar esta verificación en lugar de pedirle que se verifique de nuevo.\n\nQué se comparte: {{categories}}. No se comparte nada sin su acuerdo, y elegir no compartir no detiene su verificación.\n\nSu acuerdo cubre un solo envío a {{recipient}} y solo para este fin. Termina después de {{expires}} si los datos no se han compartido antes.\n\nPara retirar su acuerdo, {{withdraw}}. Retirarlo detiene cualquier envío que aún no se haya hecho. Los datos ya compartidos los conserva {{recipient}} según su propio aviso de privacidad.',
    destination:
      '{{recipient}} le pide su acuerdo para recibir los datos que {{source}} verificó sobre usted, para que no tenga que verificarse de nuevo.\n\nQué recibe {{recipient}}: {{categories}}. {{recipient}} los usa solo para verificar su identidad en esta solicitud y los conserva durante {{retention}}. No se recibe nada sin su acuerdo, y elegir no compartir no detiene su verificación: se verifica aquí.\n\nSu acuerdo termina después de {{expires}} si los datos no se han recibido antes.\n\nPara retirar su acuerdo, {{withdraw}}. Retirarlo detiene cualquier transferencia que aún no se haya hecho.',
    'biometric-source':
      'Acepto que {{source}} comparta mis datos biométricos con {{recipient}}: la foto de mi cara en mi documento de identidad, mi selfie y los resultados de compararlas.',
    'biometric-destination':
      'Acepto que {{recipient}} reciba mis datos biométricos de {{source}}: la foto de mi cara en mi documento de identidad, mi selfie y los resultados de compararlas. {{recipient}} los conserva durante {{retention}}, solo para verificar mi identidad.',
    accept: 'Acepto',
    decline: 'No compartir',
    withdraw: 'Retirar mi acuerdo para compartir con {{recipient}}',
  },
  step: {
    sharedBy: 'Comparte',
    sharedWith: 'Se comparte con',
    whatIsShared: 'Qué se comparte',
    saving: 'Guardando su elección…',
    biometricRequired:
      'Marque la casilla para aceptar compartir sus datos biométricos, o elija no compartir.',
    withdrawHeading: 'Su acuerdo para compartir',
    withdrawIntro:
      'Aceptó compartir sus datos verificados con {{recipient}}. Puede retirar ese acuerdo mientras esta verificación siga abierta.',
    withdrawing: 'Retirando su acuerdo…',
    withdrawn: 'Retiró su acuerdo para compartir con {{recipient}}.',
  },
  categories: {
    'identity-fields': 'sus datos de identidad, como su nombre y su fecha de nacimiento',
    'contact-fields': 'sus datos de contacto, como su correo electrónico y su teléfono',
    'other-fields': 'otros datos que introdujo',
    'document-images': 'imágenes de sus documentos de identidad',
    biometric: 'datos biométricos: fotos de su cara y los resultados de compararlas',
    'check-results': 'los resultados de las comprobaciones de sus datos',
  },
};
