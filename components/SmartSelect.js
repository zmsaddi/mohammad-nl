'use client';

import { useState, useRef, useEffect } from 'react';

export default function SmartSelect({ value, onChange, options, placeholder, allowNew, newLabel, renderOption, required, id }) {
  // Derive search directly from `value` rather than mirroring it via setState in an
  // effect (which causes cascading re-renders in React 19). Local edits update via
  // the `key` reset trick: when the parent value changes, React unmounts/remounts.
  const [search, setSearch] = useState(value || '');
  const [lastValue, setLastValue] = useState(value || '');
  if (value !== lastValue) {
    setLastValue(value || '');
    setSearch(value || '');
  }
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter((opt) => {
    const label = typeof opt === 'string' ? opt : opt.label || opt.name || '';
    return label.toLowerCase().includes(search.toLowerCase());
  });

  const isNew = search && !options.some((opt) => {
    const label = typeof opt === 'string' ? opt : opt.label || opt.name || '';
    return label === search;
  });

  const handleSelect = (opt) => {
    const val = typeof opt === 'string' ? opt : opt.value || opt.name || opt.label;
    setSearch(val);
    onChange(val, opt);
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!isOpen) { if (e.key === 'ArrowDown') setIsOpen(true); return; }
    if (e.key === 'ArrowDown') setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    else if (e.key === 'ArrowUp') setHighlighted((h) => Math.max(h - 1, 0));
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) handleSelect(filtered[highlighted]);
      else if (isNew && allowNew) { onChange(search); setIsOpen(false); }
    }
    else if (e.key === 'Escape') setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className="smart-select">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setIsOpen(true); setHighlighted(-1); }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'اكتب للبحث...'}
        required={required}
        autoComplete="off"
        className="smart-select-input"
      />
      {isOpen && (filtered.length > 0 || (isNew && allowNew)) && (
        <div className="smart-select-dropdown">
          {filtered.slice(0, 8).map((opt, i) => {
            const label = typeof opt === 'string' ? opt : opt.label || opt.name || '';
            const sub = typeof opt === 'object' ? opt.sub : null;
            return (
              <div
                key={i}
                className={`smart-select-option ${i === highlighted ? 'highlighted' : ''}`}
                onClick={() => handleSelect(opt)}
                onMouseEnter={() => setHighlighted(i)}
              >
                {renderOption ? renderOption(opt) : (
                  <>
                    <span className="smart-select-option-label">{label}</span>
                    {sub && <span className="smart-select-option-sub">{sub}</span>}
                  </>
                )}
              </div>
            );
          })}
          {isNew && allowNew && (
            <div
              className={`smart-select-option smart-select-new ${highlighted === filtered.length ? 'highlighted' : ''}`}
              onClick={() => { onChange(search); setIsOpen(false); }}
            >
              <span style={{ color: '#3b82f6' }}>+ {newLabel || 'إضافة'} «{search}»</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
