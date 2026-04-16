'use client';

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber, getTodayDate } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';

// v1.0.2 Feature 2 — profit distribution (توزيع أرباح)
//
// One logical "distribution" is a single base amount split across N
// recipients by percentage. Each recipient → one row in
// profit_distributions; all rows in a group share the same group_id.
// The locked business rules:
//
//   - Recipients must be admin or manager users only
//   - Percentages must sum to exactly 100% (1 cent tolerance)
//   - POST endpoint is admin-only; managers can view but not create
//   - base_amount can be typed manually or auto-filled from collected
//     revenue for an optional date range

function ProfitDistributionsContent() {
  const addToast = useToast();
  const [distributions, setDistributions] = useState([]);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [shareConfig, setShareConfig] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showShareConfig, setShowShareConfig] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    baseAmount: '',
    periodStart: '',
    periodEnd: '',
    notes: '',
    recipients: [],
  });
  // v1.1 F-015 — pool holds {total_collected, already_distributed,
  // remaining} matching the F-001 cap math. Pre-v1.1 we only had
  // `collectedRevenue` which was misleading because it didn't account
  // for prior distributions in the same period.
  const [pool, setPool] = useState(null);

  const fetchData = async () => {
    try {
      const [dRes, uRes, scRes] = await Promise.all([
        fetch('/api/profit-distributions', { cache: 'no-store' }),
        fetch('/api/profit-distributions/eligible-users', { cache: 'no-store' }),
        fetch('/api/profit-distributions/share-config', { cache: 'no-store' }).catch(() => ({ ok: false })),
      ]);
      const dData = await dRes.json();
      const uData = await uRes.json();
      setDistributions(Array.isArray(dData) ? dData : []);
      setEligibleUsers(Array.isArray(uData) ? uData : []);
      if (scRes?.ok) {
        const scData = await scRes.json();
        const config = (Array.isArray(scData) ? scData : []).filter(u => parseFloat(u.profit_share_pct) > 0);
        setShareConfig(config);
      }
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  // Auto-fetch the full distributable-pool breakdown whenever the
  // period bounds change. Blank bounds → all-time. The endpoint
  // accepts optional query params so either dimension can be missing.
  //
  // v1.1 F-015 — now fetches {total_collected, already_distributed,
  // remaining} so the widget below can show the user all three
  // numbers AND use `remaining` (not total_collected) as the
  // auto-fill source.
  useEffect(() => {
    if (!form.periodStart && !form.periodEnd) {
      setPool(null);
      return;
    }
    const url = new URL('/api/profit-distributions/collected-revenue', window.location.origin);
    if (form.periodStart) url.searchParams.set('start', form.periodStart);
    if (form.periodEnd)   url.searchParams.set('end',   form.periodEnd);
    fetch(url.toString(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) { setPool(null); return; }
        setPool({
          total_collected: parseFloat(d.total_collected) || 0,
          already_distributed: parseFloat(d.already_distributed) || 0,
          remaining: parseFloat(d.remaining) || 0,
        });
      })
      .catch(() => setPool(null));
  }, [form.periodStart, form.periodEnd]);

  const totalPercentage = form.recipients.reduce(
    (sum, r) => sum + (parseFloat(r.percentage) || 0),
    0
  );
  const baseAmountNum = parseFloat(form.baseAmount) || 0;
  const pctOk = Math.abs(totalPercentage - 100) < 0.01;
  const canSubmit = !submitting && pctOk && baseAmountNum > 0 &&
                    form.recipients.every((r) => r.username && parseFloat(r.percentage) > 0);

  // v1.2 — auto-populate recipients from pre-configured shares
  const loadFromConfig = () => {
    if (shareConfig.length === 0) {
      addToast('لم يتم إعداد نسب الأرباح بعد — أعد النسب أولاً', 'error');
      return;
    }
    setForm((prev) => ({
      ...prev,
      recipients: shareConfig.map(u => ({
        username: u.username,
        percentage: String(parseFloat(u.profit_share_pct)),
      })),
    }));
  };

  // v1.2 — save share config for a single user
  const saveSharePct = async (username, pct) => {
    try {
      const res = await fetch('/api/profit-distributions/share-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, percentage: pct }),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم حفظ النسبة');
        fetchData();
      } else {
        const d = await res.json();
        addToast(d.error || 'خطأ', 'error');
      }
    } catch { addToast('خطأ في الاتصال', 'error'); }
  };

  const addRecipient = () => {
    setForm((prev) => ({
      ...prev,
      recipients: [...prev.recipients, { username: '', percentage: '' }],
    }));
  };
  const removeRecipient = (idx) => {
    setForm((prev) => ({
      ...prev,
      recipients: prev.recipients.filter((_, i) => i !== idx),
    }));
  };
  const updateRecipient = (idx, field, value) => {
    setForm((prev) => {
      const next = [...prev.recipients];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, recipients: next };
    });
  };
  // v1.1 F-015 — auto-fill now uses `remaining` (the distributable
  // pool after prior distributions in the period). Pre-v1.1 this
  // copied `total_collected` which produced the v1.0.3 bug: an admin
  // who clicked "use as base" twice for the same period got the full
  // collected amount both times and the second submission created a
  // 100% over-distribution. `remaining` is what the F-001 cap will
  // accept at submit time, so what you see is what you get.
  const useRemainingAsBase = () => {
    if (pool != null && pool.remaining > 0) {
      setForm((prev) => ({ ...prev, baseAmount: pool.remaining.toFixed(2) }));
    }
  };

  const resetForm = () => {
    setForm({
      baseAmount: '',
      periodStart: '',
      periodEnd: '',
      notes: '',
      recipients: [{ username: '', percentage: '' }],
    });
    setPool(null);
  };

  // v1.1 F-015 — soft warning if the user types a baseAmount greater
  // than the remaining pool. The F-001 cap at the write path will
  // reject the submit, but surfacing the warning at input time saves
  // a round trip and is less confusing than a 400 Arabic error.
  const baseAmountNumForCheck = parseFloat(form.baseAmount) || 0;
  const exceedsPool = pool != null && baseAmountNumForCheck > (pool.remaining + 0.01);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/profit-distributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseAmount: form.baseAmount,
          recipients: form.recipients.filter((r) => r.username && r.percentage),
          basePeriodStart: form.periodStart || null,
          basePeriodEnd:   form.periodEnd   || null,
          notes: form.notes || null,
        }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast('تم تسجيل توزيع الأرباح');
        resetForm();
        setShowForm(false);
        fetchData();
      } else {
        addToast(data.error || 'خطأ في تسجيل التوزيع', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    distributions,
    { key: 'created_at', direction: 'desc' }
  );

  return (
    <AppLayout>
      <div className="page-header">
        <h2>توزيع الأرباح</h2>
        <p>توزيع صافي الربح على المدراء والمشرفين — المبلغ المتاح يساوي المُحصَّل ناقص ما تم توزيعه سابقاً</p>
      </div>

      {/* v1.2 — Share Config: pre-set profit share percentages */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showShareConfig ? '16px' : 0 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            ⚙ إعداد نسب الأرباح
          </h3>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowShareConfig(!showShareConfig)}>
            {showShareConfig ? '✕ إغلاق' : 'تعديل النسب'}
          </button>
        </div>
        {!showShareConfig && shareConfig.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px' }}>
            {shareConfig.map(u => (
              <div key={u.username} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '6px 12px', fontSize: '0.85rem' }}>
                <strong>{u.name || u.username}</strong> — {parseFloat(u.profit_share_pct)}%
              </div>
            ))}
            {(() => {
              const totalPct = shareConfig.reduce((s, u) => s + parseFloat(u.profit_share_pct || 0), 0);
              return totalPct !== 100 ? (
                <div style={{ color: '#dc2626', fontSize: '0.82rem', alignSelf: 'center' }}>
                  ⚠ المجموع: {totalPct}% (يجب أن يساوي 100%)
                </div>
              ) : (
                <div style={{ color: '#16a34a', fontSize: '0.82rem', alignSelf: 'center' }}>✓ المجموع: 100%</div>
              );
            })()}
          </div>
        )}
        {showShareConfig && (
          <div>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '12px' }}>
              حدد نسبة كل مدير/مشرف. عند إنشاء توزيع جديد، النسب تُعبَّأ تلقائياً.
            </p>
            {eligibleUsers.map(u => (
              <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ minWidth: '140px', fontWeight: 600, fontSize: '0.88rem' }}>{u.name || u.username}</span>
                <span style={{ fontSize: '0.78rem', color: '#64748b', minWidth: '50px' }}>({u.role === 'admin' ? 'مدير' : 'مشرف'})</span>
                <input
                  type="number" min="0" max="100" step="any"
                  defaultValue={(() => {
                    const found = shareConfig.find(s => s.username === u.username);
                    return found ? parseFloat(found.profit_share_pct) : 0;
                  })()}
                  onBlur={(e) => saveSharePct(u.username, e.target.value)}
                  style={{ width: '80px', padding: '6px 8px', border: '1.5px solid #d1d5db', borderRadius: '8px', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.85rem' }}>%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showForm ? '16px' : 0 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            {showForm ? 'توزيع جديد' : 'إنشاء توزيع أرباح'}
          </h3>
          <button
            type="button"
            className={showForm ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
            onClick={() => {
              if (showForm) { resetForm(); }
              else { loadFromConfig(); } // v1.2 — auto-load shares when opening
              setShowForm(!showForm);
            }}
          >
            {showForm ? '✕ إلغاء' : '➕ توزيع جديد'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>من تاريخ (اختياري)</label>
                <input
                  type="date"
                  value={form.periodStart}
                  onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>إلى تاريخ (اختياري)</label>
                <input
                  type="date"
                  value={form.periodEnd}
                  onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>قاعدة التوزيع (صافي الربح المتاح) *</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.baseAmount}
                  onChange={(e) => setForm({ ...form, baseAmount: e.target.value })}
                  placeholder="0"
                  required
                  style={exceedsPool ? { borderColor: '#dc2626' } : undefined}
                />
                {/* v1.1 F-015 — the widget now shows the full pool
                    breakdown (collected + already distributed + remaining)
                    instead of just collected. Auto-fill uses `remaining`. */}
                {pool != null && (
                  <div style={{
                    marginTop: '6px',
                    padding: '10px 12px',
                    background: exceedsPool ? '#fef2f2' : '#dbeafe',
                    border: exceedsPool ? '1px solid #dc2626' : 'none',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    color: exceedsPool ? '#991b1b' : '#1e40af',
                  }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
                      <span>💰 المُحصَّل في الفترة: <strong>{formatNumber(pool.total_collected)} €</strong></span>
                      <span>📉 موزع سابقاً: <strong>{formatNumber(pool.already_distributed)} €</strong></span>
                      <span>✅ المتاح للتوزيع: <strong>{formatNumber(pool.remaining)} €</strong></span>
                      {pool.remaining > 0 && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={useRemainingAsBase}
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                        >
                          استخدم المتاح كأساس
                        </button>
                      )}
                    </div>
                    {exceedsPool && (
                      <div style={{ marginTop: '6px', fontWeight: 600 }}>
                        ⚠ المبلغ المطلوب يتجاوز المتاح للتوزيع لهذه الفترة —
                        الحد الأقصى: {formatNumber(pool.remaining)} €
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>ملاحظات</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="ملاحظات اختيارية"
                />
              </div>
            </div>

            {/* Recipients block — dynamic list, each row picks username
                + percentage and shows the computed amount live. */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontWeight: 600 }}>المستلمون *</label>
                <button type="button" className="btn btn-outline btn-sm" onClick={addRecipient}>
                  ➕ إضافة مستلم
                </button>
              </div>
              {form.recipients.map((r, idx) => {
                const pct = parseFloat(r.percentage) || 0;
                const computedAmount = baseAmountNum > 0 && pct > 0
                  ? (baseAmountNum * pct) / 100
                  : 0;
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 120px 140px auto',
                      gap: '8px',
                      alignItems: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <select
                      value={r.username}
                      onChange={(e) => updateRecipient(idx, 'username', e.target.value)}
                      required
                    >
                      <option value="">-- اختر مستخدم --</option>
                      {eligibleUsers.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.name || u.username} ({u.role === 'admin' ? 'مدير' : 'مشرف'})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      placeholder="%"
                      value={r.percentage}
                      onChange={(e) => updateRecipient(idx, 'percentage', e.target.value)}
                      required
                    />
                    <div style={{
                      fontSize: '0.85rem',
                      color: '#16a34a',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}>
                      = {formatNumber(computedAmount)} €
                    </div>
                    {form.recipients.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeRecipient(idx)}
                        style={{ padding: '4px 10px' }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Percentage-sum indicator. Turns green when exactly 100%,
                  amber otherwise. Submit is disabled until ok. */}
              <div
                style={{
                  marginTop: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: pctOk ? '#dcfce7' : '#fef3c7',
                  color: pctOk ? '#166534' : '#92400e',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                }}
              >
                المجموع: {totalPercentage.toFixed(2)}%
                {pctOk ? ' ✅' : ' — يجب أن يساوي 100%'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                {submitting ? 'جاري الحفظ...' : 'حفظ التوزيع'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* History */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          سجل توزيعات الأرباح
        </h3>
        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد توزيعات أرباح بعد</h3>
            <p>أنشئ أول توزيع من النموذج أعلاه</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sortedRows.map((d) => (
              <div key={d.group_id} style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px',
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#16a34a' }}>
                      {formatNumber(d.base_amount)} €
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {d.created_at ? new Date(d.created_at).toISOString().slice(0, 10) : '—'}
                      {(d.base_period_start || d.base_period_end) && (
                        <span> — فترة: {d.base_period_start || '...'} → {d.base_period_end || '...'}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>بواسطة: {d.created_by}</div>
                </div>
                {/* Recipients detail */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                  {d.recipients.map((r, i) => (
                    <div key={i} style={{
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '10px 12px',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>
                        {r.username}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                        <span style={{ color: '#64748b' }}>{r.percentage}%</span>
                        <span style={{ color: '#16a34a', fontWeight: 700 }}>
                          {formatNumber(r.amount)} €
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {d.notes && (
                  <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#64748b' }}>
                    ملاحظات: {d.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function ProfitDistributionsPage() {
  return <ToastProvider><ProfitDistributionsContent /></ToastProvider>;
}
