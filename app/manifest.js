// PWA manifest (Next.js serves this at /manifest.webmanifest and auto-links it
// in <head>). Makes the app installable ("Add to Home Screen") and is the basis
// for the Android TWA/APK wrapper.
export default function manifest() {
  return {
    name: 'Vitesse Eco — الإدارة',
    short_name: 'Vitesse Eco',
    description: 'إدارة مبيعات وتوصيل الدراجات الكهربائية والإكسسوارات',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'ar',
    dir: 'rtl',
    background_color: '#ffffff',
    theme_color: '#1e40af',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
