import './globals.css';
import Providers from '@/components/Providers';

export const metadata = {
  title: 'نظام المحاسبة',
  description: 'نظام محاسبة متكامل لإدارة المبيعات والمشتريات والمصاريف',
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
