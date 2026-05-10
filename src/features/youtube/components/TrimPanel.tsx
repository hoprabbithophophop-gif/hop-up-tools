import React, { useState, useEffect, useRef } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';

const PREVIEW_DURATION = 3;

/** mm:ss(.f) または hh:mm:ss(.f) を秒に変換。失敗時は null */
function parseTime(val: string): number | null {
  const parts = val.trim().split(':').map(Number);
  if (parts.some(n => isNaN(n) || n < 0)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60)
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function TrimPanel() {
  const { state, trimItem, getCurrentTime, playChapter, pause } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const current = currentIndex !== null ? queue[currentIndex] : null;

  const [inVal, setInVal] = useState('');
  const [outVal, setOutVal] = useState('');
  const [inOutError, setInOutError] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!current) { setInVal(''); setOutVal(''); setInOutError(false); return; }
    setInVal(formatSeconds(current.startSeconds, 1));
    const end = current.endSeconds;
    setOutVal(
      isFinite(end) && end !== Number.MAX_SAFE_INTEGER ? formatSeconds(end, 1) : ''
    );
    setInOutError(false);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  const applyTrim = (nextIn: string, nextOut: string) => {
    if (!current) return;
    const start = parseTime(nextIn) ?? current.startSeconds;
    const end = parseTime(nextOut);
    const endSec = end !== null ? end : current.endSeconds;
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

  const adjustIn = (delta: number) => {
    if (!current) return;
    const base = parseTime(inVal) ?? current.startSeconds;
    const next = Math.max(0, base + delta);
    const ts = formatSeconds(next, 1);
    setInVal(ts);
    applyTrim(ts, outVal);
  };

  const adjustOut = (delta: number) => {
    if (!current) return;
    const base = parseTime(outVal);
    if (base === null) return;
    const next = Math.max(0, base + delta);
    const ts = formatSeconds(next, 1);
    setOutVal(ts);
    applyTrim(inVal, ts);
  };

  // 区間プレビュー: previewStart→previewEnd を再生し、終端で停止
  // playChapter は終端で次チャプターへ進む可能性があるため、endSeconds は元の値で渡し、
  // setTimeout で previewEnd 到達時に手動 pause する
  const previewSegment = (previewStart: number, previewEnd: number) => {
    if (!current) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    playChapter(current.videoId, previewStart, current.endSeconds);
    const ms = Math.max(0, (previewEnd - previewStart) * 1000);
    previewTimerRef.current = setTimeout(() => {
      pause();
      previewTimerRef.current = null;
    }, ms);
  };

  const confirmIn = () => {
    applyTrim(inVal, outVal);
    if (!current) return;
    const start = parseTime(inVal);
    if (start === null) return;
    const endSec = parseTime(outVal);
    const upperBound = endSec !== null ? endSec : start + PREVIEW_DURATION;
    const previewEnd = Math.min(start + PREVIEW_DURATION, upperBound);
    previewSegment(start, previewEnd);
  };

  const confirmOut = () => {
    applyTrim(inVal, outVal);
    if (!current) return;
    const end = parseTime(outVal);
    if (end === null) return;
    const startSec = parseTime(inVal) ?? current.startSeconds;
    const previewStart = Math.max(end - PREVIEW_DURATION, startSec);
    previewSegment(previewStart, end);
  };

  if (!current) {
    return (
      <div className="px-4 py-3 text-[0.625rem] text-black/40 text-center">
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
      <div className="grid grid-cols-[1fr_4rem_1fr] items-center gap-y-1">
        {/* 1行目: ラベル + 区間長 + ラベル */}
        <div className="text-center text-[0.65rem] text-black/50">開始</div>
        <div className="text-center text-[0.65rem] text-black/40 tabular-nums">
          {duration !== null ? formatSeconds(duration, 1) : ''}
        </div>
        <div className="text-center text-[0.65rem] text-black/50">終了</div>

        {/* 2行目: input + 矢印 + input */}
        <input
          type="text"
          inputMode="decimal"
          value={inVal}
          onChange={e => {
            const v = e.target.value;
            setInVal(v);
            if (parseTime(v) !== null) applyTrim(v, outVal);
          }}
          onBlur={confirmIn}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') { e.preventDefault(); adjustIn(0.1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); adjustIn(-0.1); }
            else if (e.key === 'Enter') { e.preventDefault(); confirmIn(); }
          }}
          placeholder="--:--"
          className="min-w-0 text-center text-[1.05rem] tabular-nums text-black bg-transparent py-0.5 focus:outline-none focus:bg-black/[0.03]"
        />
        <div className="text-center text-[0.85rem] text-black/30">→</div>
        <input
          type="text"
          inputMode="decimal"
          value={outVal}
          onChange={e => {
            const v = e.target.value;
            setOutVal(v);
            if (parseTime(v) !== null) applyTrim(inVal, v);
          }}
          onBlur={confirmOut}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') { e.preventDefault(); adjustOut(0.1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); adjustOut(-0.1); }
            else if (e.key === 'Enter') { e.preventDefault(); confirmOut(); }
          }}
          placeholder="--:--"
          className="min-w-0 text-center text-[1.05rem] tabular-nums text-black bg-transparent py-0.5 focus:outline-none focus:bg-black/[0.03]"
        />

        {/* 3行目: ボタン + (空) + ボタン */}
        <button
          onClick={setCurrentAsIn}
          className="py-2 text-[0.75rem] text-black/80 hover:bg-black/[0.04] active:bg-black/[0.08] cursor-pointer transition-colors"
        >
          開始をここに
        </button>
        <div></div>
        <button
          onClick={setCurrentAsOut}
          className="py-2 text-[0.75rem] text-black/80 hover:bg-black/[0.04] active:bg-black/[0.08] cursor-pointer transition-colors"
        >
          終了をここに
        </button>
      </div>

      {inOutError && (
        <p className="text-[0.6rem] text-red-600 text-center mt-2">
          開始は終了より前に設定してください
        </p>
      )}
    </div>
  );
}
