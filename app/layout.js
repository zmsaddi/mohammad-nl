import './globals.css';
import Providers from '@/components/Providers';

export const metadata = {
  title: 'Vitesse Eco - إدارة الدراجات الكهربائية',
  description: 'نظام إدارة متكامل للدراجات الكهربائية والإكسسوارات وقطع الغيار',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
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
