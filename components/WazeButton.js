'use client';

// "Navigate with Waze" button for awaiting-delivery cards. Opens the Waze
// universal link and starts navigation straight to the (text) address. Renders
// the Waze logo (blue speech-bubble + white smiley) instead of a plain emoji.
export default function WazeButton({ address }) {
  if (!address) return null;
  return (
    <a
      className="btn btn-sm"
      href={`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`}
      target="_blank"
      rel="noopener noreferrer"
      title="افتح Waze ووجّه مباشرة"
      style={{ background: '#fff', color: '#05a8e0', border: '1px solid #33ccff', fontWeight: 700, textDecoration: 'none', gap: 5 }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path fill="#33ccff" d="M20 4H4a2 2 0 00-2 2v8a2 2 0 002 2h2v2.4a.55.55 0 00.9.42L11 16h9a2 2 0 002-2V6a2 2 0 00-2-2z" />
        <circle cx="9" cy="9.6" r="1.25" fill="#fff" />
        <circle cx="15" cy="9.6" r="1.25" fill="#fff" />
        <path d="M8.7 12c.8 1.05 2 1.6 3.3 1.6s2.5-.55 3.3-1.6" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </svg>
      Waze
    </a>
  );
}
