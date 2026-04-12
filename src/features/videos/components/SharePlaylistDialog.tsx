import React, { useState, useRef, useEffect } from 'react';
import type { ChapterQueueItem } from '../types/playlist';
import { createPlaylistShare } from '../hooks/usePlaylistShare';

type Step = 'input' | 'loading' | 'result' | 'error';

interface Props {
  queue: ChapterQueueItem[];
  onClose: () => void;
}

export function SharePlaylistDialog({ queue, onClose }: Props) {
  const defaultTitle = queue[0]?.chapterLabel ?? '';
  const [title, setTitle] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [shareUrl, setShareUrl] = useState('');
  const [resolvedTitle, setResolvedTitle] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = async () => {
    setStep('loading');
    try {
      const t = title.trim() || defaultTitle;
      const url = await createPlaylistShare(t, queue);
      setShareUrl(url);
      setResolvedTitle(t);
      setStep('result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '不明なエラー');
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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={handleBackdrop}
    >
      <div className="bg-surface-container-highest w-[90vw] md:w-[420px] shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20">
          <p className="text-sm font-bold">プレイリストを共有</p>
          <button
            onClick={onClose}
            className="text-outline hover:text-primary text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4">
          {/* タイトル入力 */}
          {step === 'input' && (
            <>
              <p className="text-[0.65rem] text-outline mb-1">
                {queue.length}件 · 7日間有効（アクセスで延長）
              </p>
              {queue.length > 10 && (
                <p className="text-[0.6rem] text-amber-500 mb-2">
                  ※ 先頭10件のみ共有されます（{queue.length - 10}件は除外）
                </p>
              )}
              <label className="text-[0.6rem] font-bold uppercase tracking-widest text-outline block mb-1">
                タイトル（省略可）
              </label>
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value.slice(0, 50))}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder={defaultTitle}
                maxLength={50}
                className="w-full bg-surface-container border border-outline-variant/40 px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <p className="text-[0.55rem] text-outline/50 text-right mt-1">
                {title.length}/50
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-widest text-outline border border-outline-variant hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleCreate}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer"
                >
                  共有URLを作成
                </button>
              </div>
            </>
          )}

          {/* 生成中 */}
          {step === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <p className="text-xs text-outline uppercase tracking-widest">生成中...</p>
            </div>
          )}

          {/* 結果 */}
          {step === 'result' && (
            <>
              <p className="text-[0.65rem] text-outline mb-1">共有URLを作成しました！</p>
              <p className="text-[0.7rem] font-bold text-on-surface mb-2 line-clamp-1">
                {resolvedTitle}
              </p>
              <div className="bg-surface-container px-3 py-2 mb-1">
                <p className="text-[0.6rem] font-mono text-outline break-all">{shareUrl}</p>
              </div>
              <p className="text-[0.55rem] text-outline/50 mb-4">
                ※ 7日間有効（アクセスのたびに延長されます）
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleCopy}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer"
                >
                  {copied ? '✓ コピー済み' : '📋 コピー'}
                </button>
                <button
                  onClick={handleTweet}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  𝕏 でシェア
                </button>
              </div>
            </>
          )}

          {/* エラー */}
          {step === 'error' && (
            <>
              <p className="text-sm text-red-500 mb-4">{errorMsg}</p>
              <button
                onClick={() => setStep('input')}
                className="w-full py-2 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer"
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
