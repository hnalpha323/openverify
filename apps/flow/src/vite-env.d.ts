/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the OpenVerify API is served; unset or empty means the flow's own origin. */
  readonly VITE_OPENVERIFY_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
