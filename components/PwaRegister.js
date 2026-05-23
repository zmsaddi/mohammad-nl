'use client';

import { useEffect } from 'react';

// Registers the service worker (public/sw.js) once, on the client. Required for
// the app to be installable as a PWA and to silence PWABuilder warnings.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
