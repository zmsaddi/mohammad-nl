'use client';

import Sidebar from './Sidebar';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function AppLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <div className="loading-overlay" style={{ minHeight: '100vh' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (!session) {
    router.push('/login');
    return null;
  }

  return (
    <>
      <Sidebar />
      <main className="main-content">{children}</main>
    </>
  );
}
