import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterSW } from '@/components/register-sw';

export const metadata: Metadata = {
  title: 'RPPC Ops',
  description: 'Red Pallet Provider Co. operations',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#a30d11', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
