import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import type { ChapterQueueItem } from '../../videos/types/playlist';
import { createPlaylistShare } from '../../videos/hooks/usePlaylistShare';

const OgpEditor = lazy(() =>
  import('../../videos/components/OgpEditor').then(m => ({ default: m.OgpEditor }))
);

type Step =
  | 'input'
  | 'thumbnail'
  | 'editor'
  | 'loading'
  | 'result'
  | 'error';

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
  const [customThumbnail, setCustomThumbnail] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleTitleNext = () => {
    setResolvedTitle(title.trim() || defaultTitle);
    setStep('thumbnail');
  };

  const handleAutoThumbnail = async () => {
    setCustomThumbnail(null);
    await generateShareUrl();
  };

  const handleOpenEditor = () => {
    setStep('editor');
  };

  const handleEditorDone = async (dataUrl: string) => {
    setCustomThumbnail(dataUrl);
    await generateShareUrl();
  };

  const handleEditorCancel = () => {
    setStep('thumbnail');
  };

  const generateShareUrl = async () => {
    setStep('loading');
    try {
      const t = resolvedTitle || title.trim() || defaultTitle;
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

  if (step === 'editor') {
    return (
      <Suspense
        fallback={
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-surface-bright">
            <p className="text-xs text-outline uppercase tracking-widest">Loading...</p>
          </div>
        }
      >
        <OgpEditor
          title={resolvedTitle}
          queue={queue}
          onDone={handleEditorDone}
          onCancel={handleEditorCancel}
        />
      </Suspense>
    );
  }

  const stepLabels = ['タイトル', 'サムネイル', '共有'];
  const stepIndex = step === 'input' ? 0
    : step === 'thumbnail' ? 1
    : (step === 'result' || step === 'loading' || step === 'error') ? 2
    : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={handleBackdrop}
    >
      <div className="bg-surface border border-outline-variant/40 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20">
          <p className="text-sm font-bold">プレイリストを共有</p>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-outline hover:text-primary transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
              close
            </span>
          </button>
        </div>

        <div className="flex px-4 pt-3 pb-1 gap-1">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`h-0.5 w-full ${
                  i <= stepIndex ? 'bg-primary' : 'bg-outline-variant/30'
                }`}
              />
              <span
                className={`text-[0.5rem] uppercase tracking-widest ${
                  i <= stepIndex ? 'text-on-surface font-bold' : 'text-outline/50'
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
                onKeyDown={e => e.key === 'Enter' && handleTitleNext()}
                placeholder={defaultTitle}
                maxLength={50}
                className="w-full bg-surface-container border border-outline-variant/40 px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <p className="text-[0.55rem] text-outline/50 text-right mt-1">{title.length}/50</p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-widest text-outline border border-outline-variant hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleTitleNext}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:opacity-80 transition-opacity cursor-pointer"
                >
                  次へ
                </button>
              </div>
            </>
          )}

          {step === 'thumbnail' && (
            <>
              <p className="text-[0.6rem] font-bold uppercase tracking-widest text-outline mb-3">
                カスタムサムネを作成しますか？
              </p>

              <div className="mb-3">
                <div className="bg-surface-container p-2 mb-1">
                  <img
                    src={`https://img.youtube.com/vi/${queue[0]?.videoId}/mqdefault.jpg`}
                    alt="自動サムネイル"
                    className="w-full aspect-video object-cover"
                    crossOrigin="anonymous"
                  />
                </div>
                <p className="text-[0.5rem] text-outline/50">
                  作成しない場合、先頭動画のサムネイルが自動で使われます
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={handleOpenEditor}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:opacity-80 transition-opacity cursor-pointer"
                >
                  作成する
                </button>
                <button
                  onClick={handleAutoThumbnail}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  作成しない（自動サムネイル）
                </button>
                <button
                  onClick={() => setStep('input')}
                  className="w-full py-1.5 text-[0.55rem] font-bold uppercase tracking-widest text-outline/50 hover:text-primary transition-colors cursor-pointer"
                >
                  ← 戻る
                </button>
              </div>
            </>
          )}

          {step === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <p className="text-xs text-outline uppercase tracking-widest">生成中...</p>
            </div>
          )}

          {step === 'result' && (
            <>
              <p className="text-[0.65rem] text-outline mb-1">共有URLを作成しました</p>
              <p className="text-[0.7rem] font-bold text-on-surface mb-2 line-clamp-1">
                {resolvedTitle}
              </p>

              {customThumbnail && (
                <div className="mb-2">
                  <img
                    src={customThumbnail}
                    alt="カスタムサムネイル"
                    className="w-full aspect-[1200/630] object-cover"
                  />
                  <p className="text-[0.5rem] text-outline/50 mt-0.5">
                    カスタムサムネイル（サーバー連携は今後対応予定）
                  </p>
                </div>
              )}

              <div className="bg-surface-container px-3 py-2 mb-1">
                <p className="text-[0.6rem] font-mono text-outline break-all">{shareUrl}</p>
              </div>
              <p className="text-[0.55rem] text-outline/50 mb-4">
                ※ 7日間有効（アクセスのたびに延長されます）
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleCopy}
                  className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:opacity-80 transition-opacity cursor-pointer"
                >
                  {copied ? '✓ コピー済み' : 'コピー'}
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
