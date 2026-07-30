import React, { useState, useRef, useEffect } from 'react';
import type { ChapterQueueItem } from '../../videos/types/playlist';
import { createPlaylistShare, PLAYLIST_SHARE_LIMIT } from '../../videos/hooks/usePlaylistShare';

type Step = 'input' | 'loading' | 'result' | 'error';

interface Props {
  queue: ChapterQueueItem[];
  onClose: () => void;
}

export function ShareModal({ queue, onClose }: Props) {
  const defaultTitle = queue[0]?.chapterLabel ?? '';
  const [title, setTitle] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [shareUrl, setShareUrl] = useState('');
  const [resolvedTitle, setResolvedTitle] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleTitleNext = async () => {
    setResolvedTitle(title.trim() || defaultTitle);
    await generateShareUrl(title.trim() || defaultTitle);
  };

  const generateShareUrl = async (titleOverride?: string) => {
    setStep('loading');
    try {
      const t = titleOverride ?? (resolvedTitle || title.trim() || defaultTitle);
      setResolvedTitle(t);
      const rawUrl = await createPlaylistShare(t, queue);
      const url = rawUrl.replace('/youtube/pickup?p=', '/youtube?p=');
      setShareUrl(url);
      setStep('result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '');
      setStep('error');
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTweet = () => {
    const text = `${resolvedTitle}\n${shareUrl}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      '_blank'
    );
  };

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const stepLabels = ['タイトル', '共有'];
  const stepIndex = step === 'input' ? 0 : 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={handleBackdrop}
    >
      <div className="bg-white w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-bold text-black">プレイリストを共有</p>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-black/30 hover:text-black transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
              close
            </span>
          </button>
        </div>

        <div className="flex px-4 pt-1 pb-1 gap-1">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`h-0.5 w-full ${
                  i <= stepIndex ? 'bg-black' : 'bg-black/10'
                }`}
              />
              <span
                className={`text-[0.5rem] uppercase tracking-widest ${
                  i <= stepIndex ? 'text-black font-bold' : 'text-black/30'
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="px-4 py-4">
          {step === 'input' && (
            <>
              <p className="text-[0.65rem] text-black/40 mb-1">
                {queue.length}件 · 7日間有効（アクセスで延長）
              </p>
              {queue.length > PLAYLIST_SHARE_LIMIT && (
                <p className="text-[0.6rem] text-red-700 mb-2">
                  ※ 先頭{PLAYLIST_SHARE_LIMIT}件のみ共有されます（{queue.length - PLAYLIST_SHARE_LIMIT}件は除外）
                </p>
              )}
              <label className="text-[0.6rem] font-bold uppercase tracking-widest text-black/40 block mb-1">
                タイトル（省略可）
              </label>
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value.slice(0, 50))}
                onKeyDown={e => e.key === 'Enter' && handleTitleNext()}
                placeholder={defaultTitle}
                maxLength={50}
                className="w-full bg-black/5 border border-black/10 px-3 py-2 text-sm text-black focus:outline-none focus:border-black/30"
              />
              <p className="text-[0.55rem] text-black/30 text-right mt-1">{title.length}/50</p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-widest text-black border border-black/10 hover:bg-black/[0.04] transition-colors cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleTitleNext}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-widest bg-black text-white hover:opacity-80 transition-opacity cursor-pointer"
                >
                  次へ
                </button>
              </div>
            </>
          )}

          {step === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <p className="text-xs text-black/40 uppercase tracking-widest">生成中...</p>
            </div>
          )}

          {step === 'result' && (
            <>
              <p className="text-[0.65rem] text-black/40 mb-1">共有URLを作成しました</p>
              <p className="text-[0.7rem] font-bold text-black mb-2 line-clamp-1">
                {resolvedTitle}
              </p>

              <div className="bg-black/5 px-3 py-2 mb-1">
                <p className="text-[0.6rem] font-mono text-black/50 break-all">{shareUrl}</p>
              </div>
              <p className="text-[0.55rem] text-black/30 mb-4">
                ※ 7日間有効（アクセスのたびに延長されます）
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleCopy}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-black text-white hover:opacity-80 transition-opacity cursor-pointer"
                >
                  {copied ? '✓ コピー済み' : 'コピー'}
                </button>
                <button
                  onClick={handleTweet}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest border border-black/10 text-black hover:bg-black/[0.04] transition-colors cursor-pointer"
                >
                  𝕏 でシェア
                </button>
              </div>
            </>
          )}

          {step === 'error' && (
            <>
              <p className="text-sm text-red-700 mb-4">{errorMsg}</p>
              <button
                onClick={() => setStep('input')}
                className="w-full py-2 text-xs font-bold uppercase tracking-widest border border-black/10 text-black hover:bg-black/[0.04] transition-colors cursor-pointer"
              >
                戻る
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
