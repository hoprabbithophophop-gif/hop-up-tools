import React, { useState, useEffect } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';

/** mm:ss(.f) または hh:mm:ss(.f) を秒に変換。失敗時は null */
function parseTime(val: string): number | null {
  const parts = val.trim().split(':').map(Number);
  if (parts.some(n => isNaN(n) || n < 0)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60)
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const STEP_DELTAS = [-1, -0.1, 0.1, 1] as const;

export function TrimPanel() {
  const { state, trimItem, getCurrentTime } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const current = currentIndex !== null ? queue[currentIndex] : null;

  const [inVal, setInVal] = useState('');
  const [outVal, setOutVal] = useState('');
  const [inOutError, setInOutError] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // 再生アイテムが変わったら IN/OUT をリセット
  useEffect(() => {
    if (!current) { setInVal(''); setOutVal(''); setInOutError(false); return; }
    setInVal(formatSeconds(current.startSeconds, 1));
    const end = current.endSeconds;
    setOutVal(
      isFinite(end) && end !== Number.MAX_SAFE_INTEGER ? formatSeconds(end, 1) : ''
    );
    setInOutError(false);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTrim = (nextIn: string, nextOut: string) => {
    if (!current) return;
    const start = parseTime(nextIn) ?? current.startSeconds;
    const end = parseTime(nextOut);
    const endSec = end !== null ? end : current.endSeconds;
    // IN >= OUT の場合は警告表示し、trim は適用しない
    if (end !== null && start >= endSec) {
      setInOutError(true);
      return;
    }
    setInOutError(false);
    trimItem(current.id, start, endSec);
  };

  const setCurrentAsIn = () => {
    const t = getCurrentTime();
    const ts = formatSeconds(t, 1);
    setInVal(ts);
    applyTrim(ts, outVal);
  };

  const setCurrentAsOut = () => {
    const t = getCurrentTime();
    const ts = formatSeconds(t, 1);
    setOutVal(ts);
    applyTrim(inVal, ts);
  };

  const stepIn = (delta: number) => {
    if (!current) return;
    const base = parseTime(inVal) ?? current.startSeconds;
    const next = Math.max(0, base + delta);
    const ts = formatSeconds(next, 1);
    setInVal(ts);
    applyTrim(ts, outVal);
  };

  const stepOut = (delta: number) => {
    if (!current) return;
    const base = parseTime(outVal);
    if (base === null) return;
    const next = Math.max(0, base + delta);
    const ts = formatSeconds(next, 1);
    setOutVal(ts);
    applyTrim(inVal, ts);
  };

  if (!current) {
    return (
      <div className="px-4 py-3 text-[0.625rem] text-black/40 uppercase tracking-widest">
        再生中のアイテムがありません
      </div>
    );
  }

  const startSec = parseTime(inVal);
  const endSec = parseTime(outVal);
  const duration =
    startSec !== null && endSec !== null && endSec > startSec ? endSec - startSec : null;

  return (
    <div className="px-4 py-2">
      {/* ステータス: 開始 → 終了  長さ */}
      <div className="text-center text-[0.65rem] tabular-nums font-mono">
        <span className="text-black/60">{inVal || '--:--'}</span>
        <span className="mx-2 text-black/30">→</span>
        <span className="text-black/60">{outVal || '--:--'}</span>
        {duration !== null && (
          <span className="ml-3 text-black/40">{formatSeconds(duration, 1)}</span>
        )}
      </div>

      {/* タップ領域 2つ */}
      <div className="mt-2 flex">
        <button
          onClick={setCurrentAsIn}
          className="flex-1 py-3 text-center cursor-pointer hover:bg-black/[0.04] active:bg-black/[0.08] transition-colors"
        >
          <p className="text-[0.6rem] font-thin text-black/50 tracking-widest">開始</p>
          <p className="text-[0.8rem] font-bold text-black mt-0.5">ここに設定</p>
        </button>
        <button
          onClick={setCurrentAsOut}
          className="flex-1 py-3 text-center cursor-pointer hover:bg-black/[0.04] active:bg-black/[0.08] transition-colors"
        >
          <p className="text-[0.6rem] font-thin text-black/50 tracking-widest">終了</p>
          <p className="text-[0.8rem] font-bold text-black mt-0.5">ここに設定</p>
        </button>
      </div>

      {inOutError && (
        <p className="text-[0.6rem] text-red-600 text-center mt-2">
          開始は終了より前に設定してください
        </p>
      )}

      {/* 微調整トグル */}
      <div className="mt-2 text-center">
        <button
          onClick={() => setDetailOpen(o => !o)}
          className="text-[0.6rem] font-thin text-black/40 hover:text-black/70 cursor-pointer tracking-widest"
        >
          {detailOpen ? '︿ 微調整' : '﹀ 微調整'}
        </button>
      </div>

      {/* 微調整パネル */}
      {detailOpen && (
        <div className="mt-2 flex items-start gap-4">
          {/* 開始 */}
          <div className="flex-1 min-w-0">
            <p className="text-[0.55rem] font-thin text-black/40 mb-1 tracking-widest">開始</p>
            <input
              type="text"
              value={inVal}
              onChange={e => {
                const v = e.target.value;
                setInVal(v);
                if (parseTime(v) !== null) applyTrim(v, outVal);
              }}
              onBlur={() => applyTrim(inVal, outVal)}
              placeholder="mm:ss.f"
              className="w-full bg-transparent text-sm py-0.5 focus:outline-none tabular-nums font-mono"
            />
            <div className="flex items-center gap-1 mt-1">
              {STEP_DELTAS.map(delta => (
                <button
                  key={delta}
                  onClick={() => stepIn(delta)}
                  className="flex-1 text-[0.6rem] tabular-nums py-1 text-black/50 hover:text-black cursor-pointer"
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          </div>
          {/* 終了 */}
          <div className="flex-1 min-w-0">
            <p className="text-[0.55rem] font-thin text-black/40 mb-1 tracking-widest">終了</p>
            <input
              type="text"
              value={outVal}
              onChange={e => {
                const v = e.target.value;
                setOutVal(v);
                if (parseTime(v) !== null) applyTrim(inVal, v);
              }}
              onBlur={() => applyTrim(inVal, outVal)}
              placeholder="mm:ss.f"
              className="w-full bg-transparent text-sm py-0.5 focus:outline-none tabular-nums font-mono"
            />
            <div className="flex items-center gap-1 mt-1">
              {STEP_DELTAS.map(delta => (
                <button
                  key={delta}
                  onClick={() => stepOut(delta)}
                  className="flex-1 text-[0.6rem] tabular-nums py-1 text-black/50 hover:text-black cursor-pointer"
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
