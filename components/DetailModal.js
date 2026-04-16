'use client';

import { useEffect, useRef } from 'react';
import { formatNumber } from '@/lib/utils';

export default function DetailModal({ isOpen, onClose, title, fields, actions }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();
    const trap = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    modal.addEventListener('keydown', trap);
    return () => modal.removeEventListener('keydown', trap);
  }, [isOpen, onClose]);

  if (!isOpen || !fields) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="detail-modal" onClick={(e) => e.stopPropagation()} ref={modalRef}>
        <div className="detail-modal-header">
          <h3>{title || 'التفاصيل'}</h3>
          <button className="detail-modal-close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="detail-modal-body">
          {fields.map((field, i) => (
            field.type === 'divider' ? (
              <div key={i} className="detail-divider" />
            ) : field.type === 'badge' ? (
              <div key={i} className="detail-field">
                <span className="detail-label">{field.label}</span>
                <span className="status-badge" style={{ background: field.bg || '#f1f5f9', color: field.color || '#334155' }}>
                  {field.value}
                </span>
              </div>
            ) : field.type === 'money' ? (
              <div key={i} className="detail-field">
                <span className="detail-label">{field.label}</span>
                <span className="detail-value" style={{ color: field.color || '#1e293b', fontWeight: 700, direction: 'ltr', textAlign: 'right' }}>
                  {formatNumber(field.value)}
                </span>
              </div>
            ) : (
              <div key={i} className="detail-field">
                <span className="detail-label">{field.label}</span>
                <span className="detail-value" style={{ color: field.color, direction: field.ltr ? 'ltr' : undefined, textAlign: field.ltr ? 'right' : undefined }}>
                  {field.value || '-'}
                </span>
              </div>
            )
          ))}
        </div>
        {actions && actions.length > 0 && (
          <div className="detail-modal-footer">
            {actions.map((action, i) => (
              <button key={i} className={`btn ${action.className || 'btn-outline'} btn-sm`} onClick={action.onClick} style={action.style}>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
