'use client';

// DONE: Step 5
// Admin-only settings page. Currently exposes the editable invoice fields:
// VAT number, IBAN, BIC, VAT rate %, currency. The official legal data
// (shop_name, shop_siret, shop_address, etc.) is seeded by initDatabase()
// and shown read-only — it must not be edited from the UI.

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

function SettingsContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable invoice fields
  const [form, setForm] = useState({
    shop_vat_number:  '',
    shop_iban:        '',
    shop_bic:         '',
    vat_rate:         '20',
    invoice_currency: 'EUR',
  });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      const data = await res.json();
      setSettings(data || {});
      setForm({
        shop_vat_number:  data?.shop_vat_number  || '',
        shop_iban:        data?.shop_iban        || '',
        shop_bic:         data?.shop_bic         || '',
        vat_rate:         data?.vat_rate         || '20',
        invoice_currency: data?.invoice_currency || 'EUR',
      });
    } catch {
      addToast('خطأ في جلب الإعدادات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم حفظ الإعدادات بنجاح');
        fetchData();
      } else {
        addToast('فشل حفظ الإعدادات', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="empty-state">
          <h3>غير مصرح</h3>
          <p>الإعدادات متاحة للمدير فقط</p>
        </div>
      </AppLayout>
    );
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="loading-overlay"><div className="spinner"></div></div>
      </AppLayout>
    );
  }

  // Read-only legal info displayed for context
  const legalInfo = [
    { label: 'الاسم القانوني',     value: settings.shop_name        || '—' },
    { label: 'الشكل القانوني',     value: settings.shop_legal_form  || '—' },
    { label: 'SIREN',              value: settings.shop_siren       || '—' },
    { label: 'SIRET',              value: settings.shop_siret       || '—' },
    { label: 'كود APE',            value: settings.shop_ape         || '—' },
    { label: 'العنوان',            value: settings.shop_address     || '—' },
    { label: 'المدينة',            value: settings.shop_city        || '—' },
    { label: 'الإيميل',            value: settings.shop_email       || '—' },
    { label: 'الموقع',             value: settings.shop_website     || '—' },
  ];

  return (
    <AppLayout>
      <div className="page-header">
        <h2>الإعدادات</h2>
        <p>إعدادات المتجر والفواتير</p>
      </div>

      {/* Read-only legal info */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          البيانات القانونية الرسمية
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400, marginRight: '8px' }}>
            (للقراءة فقط — مصدرها mentions-legales)
          </span>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
          {legalInfo.map((row) => (
            <div key={row.label} style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>{row.label}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{row.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Editable invoice settings */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          إعدادات الفواتير
        </h3>
        <form onSubmit={handleSave}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="vat-number">N° TVA intracommunautaire</label>
              <input
                id="vat-number"
                type="text"
                value={form.shop_vat_number}
                onChange={(e) => setForm({ ...form, shop_vat_number: e.target.value })}
                placeholder="FR12345678901"
                style={{ direction: 'ltr', textAlign: 'right' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="vat-rate">Taux TVA (%)</label>
              <input
                id="vat-rate"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.vat_rate}
                onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="iban">IBAN</label>
              <input
                id="iban"
                type="text"
                value={form.shop_iban}
                onChange={(e) => setForm({ ...form, shop_iban: e.target.value })}
                placeholder="FR76 1234 5678 9012 3456 7890 123"
                style={{ direction: 'ltr', textAlign: 'right' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="bic">BIC / SWIFT</label>
              <input
                id="bic"
                type="text"
                value={form.shop_bic}
                onChange={(e) => setForm({ ...form, shop_bic: e.target.value })}
                placeholder="BNPAFRPP"
                style={{ direction: 'ltr', textAlign: 'right' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="currency">Devise</label>
              <select
                id="currency"
                value={form.invoice_currency}
                onChange={(e) => setForm({ ...form, invoice_currency: e.target.value })}
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}

export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsContent />
    </ToastProvider>
  );
}
