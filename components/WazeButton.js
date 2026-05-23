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
      {/* Waze app-icon style: a rounded cyan tile with a white smiling face.
          Own representation (not the trademarked file). To use the exact
          official logo, drop it at public/waze.svg and swap this for an <img>. */}
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect x="3" y="3" width="42" height="42" rx="13" fill="#33ccff" />
        <circle cx="18" cy="21" r="2.7" fill="#fff" />
        <circle cx="30" cy="21" r="2.7" fill="#fff" />
        <path d="M15.5 28c1.8 2.7 4.6 4.1 8.1 4.1s6.3-1.4 8.1-4.1" stroke="#fff" strokeWidth="2.7" fill="none" strokeLinecap="round" />
      </svg>
      Waze
    </a>
  );
}
