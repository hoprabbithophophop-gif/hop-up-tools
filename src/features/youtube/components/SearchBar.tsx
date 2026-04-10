import React, { useRef, useState, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  onSelectSuggestion?: (suggestion: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  suggestions = [],
  onSelectSuggestion,
  placeholder = '曲名・メンバー名で検索',
}: Props) {
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const showSuggestions = focused && suggestions.length > 0;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center border-b-2 border-outline-variant/40 focus-within:border-primary transition-colors">
        <span
          className="material-symbols-outlined text-outline pl-1 pr-2 leading-none select-none"
          style={{ fontSize: '20px' }}
        >
          search
        </span>
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          className="flex-1 bg-transparent py-2.5 text-sm focus:outline-none placeholder:text-outline/50"
        />
        {value && (
          <button
            onClick={() => { onChange(''); setFocused(false); }}
            className="shrink-0 px-3 h-10 flex items-center text-outline hover:text-on-surface transition-colors cursor-pointer"
          >
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: '18px' }}
            >
              close
            </span>
          </button>
        )}
      </div>
      {showSuggestions && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-surface border border-outline-variant/40 shadow-lg z-50">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={() => {
                onSelectSuggestion?.(s);
                setFocused(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container transition-colors cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
