'use client';

import { useEffect, useRef } from 'react';

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText, confirmClass, children }) {
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
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    modal.addEventListener('keydown', trap);
    return () => modal.removeEventListener('keydown', trap);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()} ref={modalRef}>
        <h3>{title || 'تأكيد'}</h3>
        {children || <p>{message || 'هل أنت متأكد؟'}</p>}
        <div className="modal-actions">
          <button className={`btn ${confirmClass || 'btn-danger'}`} onClick={onConfirm}>
            {confirmText || 'نعم، احذف'}
          </button>
          <button className="btn btn-outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
