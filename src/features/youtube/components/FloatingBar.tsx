import React from 'react';

interface Props {
  count: number;
  onPlay: () => void;
  onClear: () => void;
}

export function FloatingBar({ count, onPlay, onClear }: Props) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-14 flex items-center px-4 bg-black text-white slide-up-in">
      {/* クリア */}
      <button
        onClick={onClear}
        className="shrink-0 w-11 h-full flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
        aria-label="選択解除"
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>
          close
        </span>
      </button>

      {/* プレイ（メイン） */}
      <button
        onClick={onPlay}
        className="flex-1 h-full flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-widest cursor-pointer hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
          play_arrow
        </span>
        {count}件をプレイ
      </button>
    </div>
  );
}
