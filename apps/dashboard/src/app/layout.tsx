import './globals.css';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { ToastProvider } from '../components/toasts';

export const metadata: Metadata = {
  title: { default: 'OpenVerify Dashboard', template: '%s · OpenVerify Dashboard' },
  description: 'Operator console for OpenVerify',
};

/**
 * Every page renders per request (C170.1, F20): Next.js puts the console CSP's nonce on its
 * scripts only when a page renders per request, and `'strict-dynamic'` makes browsers ignore
 * `'self'`, so a page prerendered at build time would not hydrate under the policy.
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
