import type { Widen } from '../../../i18n/locales/en';
import type { nfcEn } from './en';

/** Spanish messages of the `nfc` step in a browser (C207.10). Machine-drafted (C161.5). */
export const nfcEs: Widen<typeof nfcEn> = {
  title: 'Este paso necesita la aplicación de la organización',
  needsApp:
    'Leer el chip de un documento requiere la aplicación de la organización; un navegador no puede leerlo.',
  otherWay: 'Puedes continuar aquí de otra manera.',
  useAnotherWay: 'Usar otra manera',
  switching: 'Cambiando a otra manera…',
  noOtherWay:
    'Continúa en la aplicación de la organización. Si no la tienes, contacta con la organización que te pidió la verificación.',
};
