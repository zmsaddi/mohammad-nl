'use client';

// Shown when a data fetch genuinely FAILS (network error or non-OK response),
// instead of the misleading "no data yet" empty state that pages used to fall
// back to on error. Gives the user an explicit retry rather than implying the
// list is simply empty. Visual styling reuses the `.empty-state` block from
// globals.css so it matches the rest of the app with no new CSS.
export default function ErrorState({ onRetry, message = 'تعذّر تحميل البيانات' }) {
  return (
    <div className="empty-state" role="alert">
      <h3>{message}</h3>
      <p>تحقّق من الاتصال بالإنترنت ثم أعد المحاولة</p>
      {onRetry && (
        <button
          className="btn btn-sm"
          onClick={onRetry}
          style={{ marginTop: 8, background: '#e2e8f0', color: '#334155' }}
        >
          ↻ إعادة المحاولة
        </button>
      )}
    </div>
  );
}
