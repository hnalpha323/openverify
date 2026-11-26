import { Alert, Button, Card } from '@openverify/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  requestCamera as requestBrowserCamera,
  stopStream,
  type CameraAccess,
  type CameraErrorCode,
} from '../lib/camera-permission';

export interface CameraCheckProps {
  /** Injected in tests; defaults to the browser camera. */
  requestCamera?: () => Promise<CameraAccess>;
}

type CheckState =
  | { readonly status: 'idle' | 'requesting' | 'ready' }
  | { readonly status: 'failed'; readonly code: CameraErrorCode };

/** Asks for camera permission up front and explains, in the user's language, what went wrong. */
export function CameraCheck({ requestCamera = requestBrowserCamera }: CameraCheckProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CheckState>({ status: 'idle' });

  const check = async () => {
    setState({ status: 'requesting' });
    const result = await requestCamera();
    if (result.ok) {
      // This step only proves access; capture steps open the camera again when they need it.
      stopStream(result.stream);
      setState({ status: 'ready' });
    } else {
      setState({ status: 'failed', code: result.error.code });
    }
  };

  return (
    <Card title={t('camera.title')} headingLevel={1}>
      <div className="flex flex-col gap-6">
        <p>{t('camera.intro')}</p>
        {state.status === 'requesting' && <Alert tone="info">{t('camera.requesting')}</Alert>}
        {state.status === 'ready' && <Alert tone="success">{t('camera.ready')}</Alert>}
        {state.status === 'failed' && (
          <Alert tone="error">{t(`camera.errors.${state.code}`)}</Alert>
        )}
        <Button
          className="sm:self-end"
          disabled={state.status === 'requesting'}
          onClick={() => {
            void check();
          }}
        >
          {t('camera.request')}
        </Button>
      </div>
    </Card>
  );
}
