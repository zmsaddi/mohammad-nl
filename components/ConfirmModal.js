'use client';

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title || 'تأكيد'}</h3>
        <p>{message || 'هل أنت متأكد؟'}</p>
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={onConfirm}>
            نعم، احذف
          </button>
          <button className="btn btn-outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
