'use client';

// Filter controls wrapper — now a pure passthrough.
//
// The mobile bottom-sheet design was removed per user feedback ("I do not like
// mobile filter"): filters are now ALWAYS VISIBLE inline on every viewport,
// exactly as they already rendered on desktop. Rendering the children directly
// (no wrapper element) keeps the desktop layout pixel-identical and simply lets
// the same inline filters show on mobile too. Pages still pass chips/isActive/
// onClear; they are intentionally ignored here (the pages keep their own inline
// "✕ مسح" reset button).
export default function FilterSheet({ children }) {
  return <>{children}</>;
}
