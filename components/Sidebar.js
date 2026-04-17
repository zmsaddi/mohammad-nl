'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';

// Group definitions: order matters for rendering
const navGroups = [
  { key: null, label: null },             // ungrouped (dashboard) — rendered first, no label
  { key: 'operations', label: 'عمليات' },
  { key: 'financial', label: 'مالية' },
  { key: 'data', label: 'بيانات' },
  { key: 'system', label: 'نظام' },
];

const navLinks = [
  { href: '/summary', label: 'لوحة التحكم', group: null, roles: ['admin', 'manager', 'seller'], icon: '📊' },
  { href: '/purchases', label: 'المشتريات', group: 'operations', roles: ['admin', 'manager'], icon: '🛒' },
  { href: '/sales', label: 'المبيعات', group: 'operations', roles: ['admin', 'manager', 'seller'], icon: '💰' },
  { href: '/expenses', label: 'المصاريف', group: 'operations', roles: ['admin', 'manager'], icon: '📋' },
  { href: '/stock', label: 'المخزون', group: 'data', roles: ['admin', 'manager', 'seller'], icon: '📦' },
  { href: '/deliveries', label: 'التوصيل', group: 'operations', roles: ['admin', 'manager', 'seller', 'driver'], icon: '🚚' },
  { href: '/my-bonus', label: 'العمولة', group: 'data', roles: ['seller', 'driver'], icon: '💵' },
  { href: '/invoices', label: 'الفواتير', group: 'financial', roles: ['admin', 'manager', 'seller', 'driver'], icon: '🧾' },
  { href: '/clients', label: 'العملاء', group: 'data', roles: ['admin', 'manager'], icon: '👥' },
  { href: '/suppliers', label: 'الموردين', group: 'data', roles: ['admin', 'manager'], icon: '🏭' },
  { href: '/settlements', label: 'التسويات', group: 'financial', roles: ['admin'], icon: '⚖️' },
  { href: '/profit-distributions', label: 'توزيع الأرباح', group: 'financial', roles: ['admin', 'manager'], icon: '💸' },
  { href: '/settings', label: 'الإعدادات', group: 'system', roles: ['admin'], icon: '⚙️' },
  { href: '/users', label: 'المستخدمين', group: 'system', roles: ['admin'], icon: '👤' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const userName = session?.user?.name || 'مستخدم';
  const role = session?.user?.role || 'seller';
  const roleLabels = { admin: 'مدير عام', manager: 'مشرف', seller: 'بائع', driver: 'سائق' };
  const userRole = roleLabels[role] || role;
  const initials = userName.charAt(0);
  const visibleLinks = navLinks.filter((link) => !link.roles || link.roles.includes(role));

  return (
    <>
      {/* Mobile/tablet top bar — always visible below 1024px, hidden on desktop.
          Contains: hamburger (right) + app name (center) + user + signout (left).
          Replaces the old floating hamburger button that users couldn't find. */}
      <div className="mobile-topbar">
        <button className="mobile-topbar-menu" onClick={() => setIsOpen(!isOpen)} aria-label="القائمة">
          {isOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="22" height="22">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="22" height="22">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
        <span className="mobile-topbar-title">Vitesse Eco</span>
        <div className="mobile-topbar-user">
          <span className="mobile-topbar-name">{userName}</span>
          <button className="mobile-topbar-signout" onClick={() => signOut({ callbackUrl: '/login' })} aria-label="تسجيل الخروج">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </div>

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>Vitesse Eco</h1>
          <p>دراجات كهربائية وإكسسوارات</p>
        </div>

        <nav className="sidebar-nav">
          {navGroups
            .filter((g) => visibleLinks.some((link) => link.group === g.key))
            .map((g) => {
              const groupLinks = visibleLinks.filter((link) => link.group === g.key);
              return (
                <div key={g.key || '__top'} className={g.label ? 'sidebar-group' : undefined}>
                  {g.label && <div className="sidebar-group-label">{g.label}</div>}
                  {groupLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`sidebar-link ${pathname === link.href || pathname.startsWith(link.href + '/') ? 'active' : ''}`}
                      onClick={() => setIsOpen(false)}
                    >
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>{link.icon}</span>
                      <span>{link.label}</span>
                    </Link>
                  ))}
                </div>
              );
            })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div>
              <div style={{ fontWeight: 600 }}>{userName}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{userRole}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={() => signOut({ callbackUrl: '/login' })}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Overlay AFTER sidebar — CSS sibling selector + .open class both work */}
      {isOpen && <div className="sidebar-overlay open" onClick={() => setIsOpen(false)} />}
    </>
  );
}
