import './globals.css';
import Providers from '@/components/Providers';

export const metadata = {
  title: 'Mohammad NL - إدارة الدراجات الكهربائية',
  description: 'نظام إدارة متكامل للدراجات الكهربائية والإكسسوارات وقطع الغيار',
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
