/** What the MFA sign-in actions answer the `/login/mfa` page (C22). Client-safe. */

export type MfaCodeError = 'invalid_code' | 'invalid_input' | 'unavailable';

/**
 * A code that was refused while the `mfa-token` is still usable (`invalid_code`), one not shaped
 * like a code, or an API that could not answer. The page cannot say how many attempts are left:
 * the API counts them, and when they run out the action returns to sign-in (C25.1).
 */
export interface MfaCodeState {
  readonly error: MfaCodeError | null;
}

export const INITIAL_MFA_CODE_STATE: MfaCodeState = Object.freeze({ error: null });

export type WebauthnLoginStart =
  | { readonly ok: true; readonly options: Record<string, unknown> }
  | { readonly ok: false; readonly error: 'expired' | 'unavailable' };

export type WebauthnLoginFinish =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: 'rejected' | 'invalid_input' | 'unavailable' | 'expired';
    };
