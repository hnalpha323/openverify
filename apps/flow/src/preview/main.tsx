/**
 * C156.2, C156.3 (Workflow 9A): the preview entry, built from `preview.html` as its own bundle so the
 * preview's stricter policy (`connect-src 'none'`, `frame-ancestors` the console origin) never
 * constrains the hosted flow. Owner: `flow-server-embed`, which builds the console protocol, the
 * asset message and the rendering (after `flow-renderer`'s first checkpoint); the Vite input was
 * placed by `foundation-9a` (Stage 1b (F)).
 */
// Must stay the first import: it configures zod before any module parses a schema.
import '../security/csp-safe-zod';
import '../index.css';
import { startPreview } from './start';

startPreview(document);
