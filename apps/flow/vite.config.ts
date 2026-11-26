import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';
import { FLOW_RESPONSE_HEADERS } from './src/security/response-headers';
import { securityMetaPlugin } from './src/security/security-meta';
import { faceGuidanceBuild } from './src/vite-plugins/face-guidance-build';
import {
  defaultGuidanceAssets,
  guidanceAssetsPlugin,
} from './src/vite-plugins/guidance-assets-plugin';

// VITE_* variables come from the repository's .env (see .env.example) or the environment.
const ENV_DIR = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = ENV_DIR;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, 'VITE_');
  // C289 (Phase 11, Workflow 11C): OPENVERIFY_FLOW_FACE_GUIDANCE=off builds without onnxruntime-web.
  const guidance = faceGuidanceBuild(
    process.env,
    defaultGuidanceAssets(REPO_ROOT),
    fileURLToPath(new URL('src/guidance/no-face-guidance.ts', import.meta.url)),
  );
  return {
    envDir: ENV_DIR,
    define: { ...guidance.define },
    plugins: [
      react(),
      tailwindcss(),
      // Production builds get a CSP <meta> allowing the configured API origin.
      securityMetaPlugin({ apiUrl: env.VITE_OPENVERIFY_API_URL }),
      // The face guidance's model and WASM files, each checked against its SHA-256 (C46.1).
      guidanceAssetsPlugin({ assets: guidance.assets }),
    ],
    // C107.9: the headers a <meta> cannot carry, sent by the compose-served flow (`vite preview`).
    preview: { headers: { ...FLOW_RESPONSE_HEADERS } },
    // C156.2, C156.3 (Workflow 9A Stage 1b (F)): the console's preview is its own bundle, so its
    // stricter policy (sent by the flow server) never constrains the hosted flow.
    build: {
      rolldownOptions: {
        input: {
          main: fileURLToPath(new URL('index.html', import.meta.url)),
          preview: fileURLToPath(new URL('preview.html', import.meta.url)),
        },
      },
    },
    resolve: {
      alias: { ...guidance.alias },
      conditions: [
        // onnxruntime-web without its WASM bundled in: the guidance loads the verified copy.
        'onnxruntime-web-use-extern-wasm',
        // Bundle workspace packages from their TypeScript source (see @openverify/config/vitest).
        '@openverify/source',
        ...defaultClientConditions,
      ],
    },
  };
});
