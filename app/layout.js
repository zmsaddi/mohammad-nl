import './globals.css';
import Providers from '@/components/Providers';

export const metadata = {
  title: 'Vitesse Eco - إدارة الدراجات الكهربائية',
  description: 'نظام إدارة متكامل للدراجات الكهربائية والإكسسوارات وقطع الغيار',
};

// Next.js 16 requires viewport to be its own export.
// v1.1 F-029 — removed maximumScale:1 + userScalable:false. Pre-v1.1
// these locked the viewport to prevent zoom, which broke WCAG 1.4.4
// (users could not pinch-zoom to read small table text on mobile).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
