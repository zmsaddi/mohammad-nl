import './globals.css';
import Providers from '@/components/Providers';

export const metadata = {
  title: 'Vitesse Eco - إدارة الدراجات الكهربائية',
  description: 'نظام إدارة متكامل للدراجات الكهربائية والإكسسوارات وقطع الغيار',
};

// Next.js 16 requires viewport to be its own export.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
