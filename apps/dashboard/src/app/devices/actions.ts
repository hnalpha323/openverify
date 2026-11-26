'use server';

/**
 * Trust Device from the console (C127.9): `POST /devices/:id/trust` under `devices:write`, with a
 * snake_case reason code to trust, or `untrust` to clear the mark. The mark is read by workflow
 * conditions only; no check and no signal reads it. A refused reason is named by its pointer and
 * never echoed (P21).
 */
import { deviceTrustReasonSchema, idSchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';

const trustInputSchema = z.strictObject({
  'device-id': idSchema('dev'),
  'inquiry-id': idSchema('inq'),
  mode: z.enum(['trust', 'untrust']),
});

export async function setDeviceTrust(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['devices:write'] }, async ({ api }) => {
    const input = parseInput(trustInputSchema, {
      'device-id': formString(formData, 'device-id'),
      'inquiry-id': formString(formData, 'inquiry-id'),
      mode: formString(formData, 'mode'),
    });
    if (input.mode === 'untrust') {
      await api.devices.trust(input['device-id'], { untrust: true });
    } else {
      const reason = deviceTrustReasonSchema.safeParse(formString(formData, 'trust-reason') ?? '');
      if (!reason.success) {
        throw new ActionInputError({
          title: 'Check the values you entered',
          errors: [
            {
              pointer: '/meta/trust-reason',
              detail: 'Use a snake_case code, such as known_customer_device.',
            },
          ],
        });
      }
      await api.devices.trust(input['device-id'], { 'trust-reason': reason.data });
    }
    revalidatePath(`/inquiries/${input['inquiry-id']}`);
    return undefined;
  });
}
