import React, { useState, useEffect } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';

/** mm:ss または hh:mm:ss を秒に変換。失敗時は null */
function parseTime(val: string): number | null {
  const parts = val.trim().split(':').map(Number);
  if (parts.some(n => isNaN(n) || n < 0)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60)
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function TrimPanel() {
  const { state, trimItem, getCurrentTime } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const current = currentIndex !== null ? queue[currentIndex] : null;

  const [inVal, setInVal] = useState('');
  const [outVal, setOutVal] = useState('');

  // 再生アイテムが変わったら IN/OUT をリセット
  useEffect(() => {
    if (!current) { setInVal(''); setOutVal(''); return; }
    setInVal(formatSeconds(current.startSeconds));
    const end = current.endSeconds;
    setOutVal(
      isFinite(end) && end !== Number.MAX_SAFE_INTEGER ? formatSeconds(end) : ''
    );
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTrim = (nextIn: string, nextOut: string) => {
    if (!current) return;
    const start = parseTime(nextIn) ?? current.startSeconds;
    const end = parseTime(nextOut);
    const endSec = end !== null ? end : current.endSeconds;
    trimItem(current.id, start, endSec);
  };

  const setCurrentAsIn = () => {
    const t = Math.floor(getCurrentTime());
    const ts = formatSeconds(t);
    setInVal(ts);
    applyTrim(ts, outVal);
  };

  const setCurrentAsOut = () => {
    const t = Math.floor(getCurrentTime());
    const ts = formatSeconds(t);
    setOutVal(ts);
    applyTrim(inVal, ts);
  };

  if (!current) {
    return (
      <div className="px-4 py-3 text-[0.625rem] text-outline uppercase tracking-widest">
        再生中のアイテムがありません
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-6">
        {/* IN */}
        <div className="flex-1">
          <p className="text-[0.6rem] font-bold uppercase tracking-widest text-outline mb-1">
            IN
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inVal}
              onChange={e => {
                const v = e.target.value;
                setInVal(v);
                if (parseTime(v) !== null) applyTrim(v, outVal);
              }}
              onBlur={() => applyTrim(inVal, outVal)}
              placeholder="mm:ss"
              className="w-20 bg-transparent border-b border-outline-variant/40 text-sm py-0.5 focus:outline-none focus:border-primary transition-colors tabular-nums font-mono"
            />
            <button
              onClick={setCurrentAsIn}
              title="現在位置をINにセット"
              className="text-outline hover:text-primary transition-colors cursor-pointer"
            >
              <span
                className="material-symbols-outlined leading-none"
                style={{ fontSize: '18px' }}
              >
                my_location
              </span>
            </button>
          </div>
        </div>

        {/* OUT */}
        <div className="flex-1">
          <p className="text-[0.6rem] font-bold uppercase tracking-widest text-outline mb-1">
            OUT
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={outVal}
              onChange={e => {
                const v = e.target.value;
                setOutVal(v);
                if (parseTime(v) !== null) applyTrim(inVal, v);
              }}
              onBlur={() => applyTrim(inVal, outVal)}
              placeholder="mm:ss"
              className="w-20 bg-transparent border-b border-outline-variant/40 text-sm py-0.5 focus:outline-none focus:border-primary transition-colors tabular-nums font-mono"
            />
            <button
              onClick={setCurrentAsOut}
              title="現在位置をOUTにセット"
              className="text-outline hover:text-primary transition-colors cursor-pointer"
            >
              <span
                className="material-symbols-outlined leading-none"
                style={{ fontSize: '18px' }}
              >
                my_location
              </span>
            </button>
          </div>
        </div>
      </div>
      <p className="text-[0.55rem] text-outline/60 mt-2">
        ◉ ボタンで現在の再生位置をセット
      </p>
    </div>
  );
}
