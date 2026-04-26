import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { makeChapterId, buildChapterQueueItems, buildFullVideoQueueItem, formatSeconds } from '../../videos/utils/playlist-utils';
import type { ChapterQueueItem } from '../../videos/types/playlist';

function buildChapterUrl(videoId: string, startSeconds: number): string {
  return `https://youtu.be/${videoId}?t=${Math.floor(startSeconds)}`;
}

interface ShareTarget {
  label: string;
  videoId: string;
  startSeconds: number;
}

interface VideoForSheet {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  description_short: string;
  published_at?: string;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

function parseChapters(description: string): Chapter[] {
  if (!description) return [];
  const re = new RegExp('^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?[\\u200B]*[～〜\\s\\-]+(.+)$', 'gm');
  const chapters: Chapter[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    const hasHours = m[3] !== undefined;
    const h = hasHours ? parseInt(m[1], 10) : 0;
    const min = hasHours ? parseInt(m[2], 10) : parseInt(m[1], 10);
    const sec = hasHours ? parseInt(m[3], 10) : parseInt(m[2], 10);
    chapters.push({
      seconds: h * 3600 + min * 60 + sec,
      label: m[4].trim(),
      timestamp: hasHours ? `${m[1]}:${m[2]}:${m[3]}` : `${m[1]}:${m[2]}`,
    });
  }
  return chapters;
}

/** PickupView: 選択モード */
interface SelectionMode {
  kind: 'selection';
  getSelectionNumber: (id: string) => number;
  onToggle: (id: string, item: ChapterQueueItem) => void;
  onSelectAll: (items: ChapterQueueItem[]) => void;
}

/** PlayView: キューに直接追加モード */
interface AddMode {
  kind: 'add';
  onAdd: (item: ChapterQueueItem) => void;
  onInsertNext?: (item: ChapterQueueItem) => void;
  onRemove: (id: string) => void;
  isInQueue: (id: string) => boolean;
}

type SheetMode = SelectionMode | AddMode;

interface Props {
  video: VideoForSheet;
  onClose: () => void;
  mode: SheetMode;
}

function buildPreviewSrc(item: ChapterQueueItem): string {
  const start = Math.floor(item.startSeconds);
  const hasEnd = isFinite(item.endSeconds) && item.endSeconds !== Number.MAX_SAFE_INTEGER;
  const end = hasEnd ? `&end=${Math.floor(item.endSeconds)}` : '';
  return `https://www.youtube.com/embed/${item.videoId}?start=${start}&autoplay=1&rel=0&controls=1${end}`;
}

export function VideoChapterSheet({ video, onClose, mode }: Props) {
  const chapters = useMemo(() => parseChapters(video.description_short), [video.description_short]);

  const chapterItems = useMemo<ChapterQueueItem[]>(() => {
    if (chapters.length === 0) return [];
    return buildChapterQueueItems(
      { video_id: video.video_id, title: video.title, channel_name: video.channel_name, thumbnail_url: video.thumbnail_url },
      chapters
    );
  }, [video, chapters]);

  const fullVideoItem = useMemo(() => buildFullVideoQueueItem({
    video_id: video.video_id,
    title: video.title,
    channel_name: video.channel_name,
    thumbnail_url: video.thumbnail_url,
  }), [video]);

  const [previewItem, setPreviewItem] = useState<ChapterQueueItem | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const hasDescription = Boolean(video.description_short?.trim());

  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  }, []);

  const handleShare = useCallback((label: string, videoId: string, startSeconds: number) => {
    setShareTarget({ label, videoId, startSeconds });
  }, []);

  const getShareUrl = useCallback(() => {
    if (!shareTarget) return '';
    return buildChapterUrl(shareTarget.videoId, shareTarget.startSeconds);
  }, [shareTarget]);

  const handleCopyShareUrl = useCallback(async () => {
    const url = getShareUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setShareTarget(null);
    showToast('URLをコピーしました');
  }, [getShareUrl, showToast]);

  const handleShareToX = useCallback(() => {
    if (!shareTarget) return;
    const url = getShareUrl();
    const text = encodeURIComponent(shareTarget.label);
    const encodedUrl = encodeURIComponent(url);
    window.open(`https://x.com/intent/tweet?text=${text}&url=${encodedUrl}`, '_blank', 'noopener');
    setShareTarget(null);
  }, [shareTarget, getShareUrl]);

  // Esc でも閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // スクロールロック
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* オーバーレイ */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* シートパネル */}
      <div className="w-full max-w-lg mx-auto">
      <div className="relative bg-white max-h-[70vh] flex flex-col">
        {/* 動画情報ヘッダー */}
        <div className="shrink-0">
          <div className="flex items-center gap-3 px-4 py-3">
            <img
              src={`https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`}
              alt={video.title}
              className="w-16 shrink-0 object-cover"
              style={{ height: '36px', aspectRatio: '16/9' }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[0.8rem] font-bold leading-snug line-clamp-2">{video.title}</p>
              <p className="text-[0.7rem] font-thin text-black/40 mt-[0.2rem]">{video.channel_name}</p>
            </div>
            {hasDescription && (
              <button
                onClick={() => setDescOpen(v => !v)}
                className="w-8 h-8 flex items-center justify-center cursor-pointer shrink-0 text-black/30"
                aria-label={descOpen ? '概要を閉じる' : '概要を見る'}
              >
                <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>
                  {descOpen ? 'expand_less' : 'subject'}
                </span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-black/30 cursor-pointer shrink-0"
              aria-label="閉じる"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>close</span>
            </button>
          </div>

          {/* 概要欄（展開時） */}
          {descOpen && (
            <div className="px-4 py-3 max-h-48 overflow-y-auto bg-black/5">
              {video.published_at && (
                <p className="text-[0.65rem] font-thin text-black/40 mb-2">
                  {new Date(video.published_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              )}
              <p className="text-[0.7rem] font-thin text-black/60 whitespace-pre-wrap leading-relaxed">
                {video.description_short}
              </p>
            </div>
          )}
        </div>

        {/* アクションバー（選択モード時：全選択ボタン） */}
        {mode.kind === 'selection' && chapterItems.length > 0 && (
          <div className="px-4 py-2 shrink-0 flex items-center justify-between">
            <p className="text-[0.7rem] font-thin text-black/40 uppercase tracking-widest">
              {chapters.length} chapters
            </p>
            <button
              onClick={() => mode.onSelectAll(chapterItems)}
              className="text-[0.8rem] font-bold uppercase cursor-pointer"
            >
              全て選択
            </button>
          </div>
        )}

        {/* ミニプレビュー */}
        {previewItem && (
          <div className="shrink-0 px-4 pt-3 pb-2 bg-white">
            <div className="bg-black overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <p className="flex-1 min-w-0 text-white text-[0.7rem] font-thin truncate">
                  {previewItem.chapterLabel}
                </p>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="shrink-0 text-white/50 cursor-pointer"
                  aria-label="プレビューを閉じる"
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>close</span>
                </button>
              </div>
              <div className="w-full aspect-video">
                <iframe
                  key={previewItem.id}
                  src={buildPreviewSrc(previewItem)}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  title={previewItem.chapterLabel}
                />
              </div>
            </div>
          </div>
        )}

        {/* チャプターリスト */}
        <div className="overflow-y-auto flex-1">
          {/* 全編再生 */}
          <ChapterRow
            id={fullVideoItem.id}
            label="全編再生"
            timeRange=""
            mode={mode}
            item={fullVideoItem}
            isFullVideo
            onPreview={() => setPreviewItem(prev => prev?.id === fullVideoItem.id ? null : fullVideoItem)}
            isPreviewActive={previewItem?.id === fullVideoItem.id}
            onShare={() => handleShare(video.title, video.video_id, 0)}
          />

          {chapterItems.length === 0 && (
            <p className="px-4 py-4 text-[0.7rem] font-thin text-black/40">
              チャプター情報がありません
            </p>
          )}

          {chapterItems.map(item => (
            <ChapterRow
              key={item.id}
              id={item.id}
              label={item.chapterLabel}
              timeRange={`${formatSeconds(item.startSeconds)}${
                isFinite(item.endSeconds) && item.endSeconds !== Number.MAX_SAFE_INTEGER
                  ? ` — ${formatSeconds(item.endSeconds)}`
                  : ''
              }`}
              mode={mode}
              item={item}
              isFullVideo={false}
              onPreview={() => setPreviewItem(prev => prev?.id === item.id ? null : item)}
              isPreviewActive={previewItem?.id === item.id}
              onShare={() => handleShare(item.chapterLabel, item.videoId, item.startSeconds)}
            />
          ))}

          {/* すべてをキューに追加 */}
          {mode.kind === 'add' && chapterItems.length > 0 && (
            <div className="px-4 py-4">
              <button
                onClick={() => chapterItems.forEach(ci => { if (!mode.isInQueue(ci.id)) mode.onAdd(ci); })}
                className="w-full py-3 bg-black text-white text-[0.8rem] font-bold uppercase cursor-pointer"
              >
                すべてをキューに追加
              </button>
            </div>
          )}

          <div className="h-6" />
        </div>
      </div>
      </div>

      {/* シェアモーダル */}
      {shareTarget && (
        <ShareChapterModal
          target={shareTarget}
          onUpdateSeconds={s => setShareTarget(prev => prev ? { ...prev, startSeconds: s } : null)}
          onCopy={handleCopyShareUrl}
          onShareToX={handleShareToX}
          onShareOther={async () => {
            const url = getShareUrl();
            if (!url) return;
            try {
              await navigator.share({ title: shareTarget.label, url });
            } catch { /* キャンセル */ }
          }}
          onOpenYouTube={() => {
            const url = getShareUrl();
            if (url) window.open(url, '_blank', 'noopener');
          }}
          onClose={() => setShareTarget(null)}
          getShareUrl={getShareUrl}
        />
      )}

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] bg-black text-white text-[0.75rem] font-thin px-4 py-2">
          {toast}
        </div>
      )}
    </div>
  );
}

function secondsToTimestamp(s: number): string {
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function timestampToSeconds(ts: string): number | null {
  const parts = ts.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

interface ShareChapterModalProps {
  target: ShareTarget;
  onUpdateSeconds: (s: number) => void;
  onCopy: () => void;
  onShareToX: () => void;
  onShareOther: () => void;
  onOpenYouTube: () => void;
  onClose: () => void;
  getShareUrl: () => string;
}

function ShareChapterModal({ target, onUpdateSeconds, onCopy, onShareToX, onShareOther, onOpenYouTube, onClose, getShareUrl }: ShareChapterModalProps) {
  const [tsInput, setTsInput] = useState(() => secondsToTimestamp(target.startSeconds));
  const [tsError, setTsError] = useState(false);

  const handleTsChange = (val: string) => {
    setTsInput(val);
    const secs = timestampToSeconds(val);
    if (secs !== null && secs >= 0) {
      setTsError(false);
      onUpdateSeconds(secs);
    } else {
      setTsError(true);
    }
  };

  const url = getShareUrl();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-[320px] p-5">
        <p className="text-[0.8rem] font-bold leading-snug mb-3 line-clamp-2">{target.label}</p>

        <div className="mb-3">
          <label className="text-[0.6rem] font-bold uppercase tracking-widest text-black/40 block mb-1">
            開始タイムスタンプ
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tsInput}
              onChange={e => handleTsChange(e.target.value)}
              className={`w-20 text-[0.8rem] font-bold text-center py-1 border ${
                tsError ? 'border-red-400 text-red-500' : 'border-black/20'
              } bg-black/5 focus:outline-none focus:border-black`}
              placeholder="0:00"
            />
            <p className="text-[0.6rem] font-thin text-black/40 truncate flex-1">{url}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onCopy}
            className="w-full py-2.5 bg-black text-white text-[0.75rem] font-bold cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>content_copy</span>
            URLをコピー
          </button>
          <button
            onClick={onOpenYouTube}
            className="w-full py-2.5 bg-black text-white text-[0.75rem] font-bold cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>play_arrow</span>
            YouTubeで開く
          </button>
          <div className="flex gap-2">
            <button
              onClick={onShareToX}
              className="flex-1 py-2.5 bg-black/10 text-black text-[0.75rem] font-bold cursor-pointer"
            >
              𝕏
            </button>
            {typeof navigator !== 'undefined' && !!navigator.share && (
              <button
                onClick={onShareOther}
                className="flex-1 py-2.5 bg-black/10 text-black text-[0.75rem] font-bold cursor-pointer"
              >
                その他...
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChapterRowProps {
  id: string;
  label: string;
  timeRange: string;
  mode: SheetMode;
  item: ChapterQueueItem;
  isFullVideo: boolean;
  onPreview: () => void;
  isPreviewActive: boolean;
  onShare?: () => void;
}

function ChapterRow({ id, label, timeRange, mode, item, isFullVideo, onPreview, isPreviewActive, onShare }: ChapterRowProps) {
  const [pressed, setPressed] = useState(false);
  const pressStyle: React.CSSProperties = {
    transform: pressed ? 'scale(0.97)' : 'scale(1)',
    transition: pressed
      ? 'transform 80ms ease-out'
      : 'transform 150ms ease-out',
  };

  if (mode.kind === 'selection') {
    const num = mode.getSelectionNumber(id);
    const isSelected = num > 0;
    return (
      <div
        onClick={() => mode.onToggle(id, item)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && mode.onToggle(id, item)}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        className={`flex items-center gap-3 px-4 py-[0.8rem] cursor-pointer ${
          isSelected ? 'bg-[#F0F0F0]' : ''
        }`}
        style={pressStyle}
      >
        <div
          className="flex-1 min-w-0"
          onClick={e => { e.stopPropagation(); onPreview(); }}
        >
          <p className={`text-[0.8rem] font-bold leading-snug ${isPreviewActive ? 'text-black' : ''}`}>
            {label}
          </p>
          {timeRange && <p className="text-[0.7rem] font-thin text-black/40 mt-[0.2rem]">{timeRange}</p>}
        </div>
        <div className="shrink-0 w-9 h-9 flex items-center justify-center">
          {isSelected ? (
            <span className="w-6 h-6 bg-black text-white flex items-center justify-center text-[0.7rem] font-bold leading-none">
              {num}
            </span>
          ) : (
            <span className="w-6 h-6 bg-black/10 flex items-center justify-center text-black/40">
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>add</span>
            </span>
          )}
        </div>
        {onShare && (
          <button
            onClick={e => { e.stopPropagation(); onShare(); }}
            className="shrink-0 w-8 h-8 flex items-center justify-center text-black/30 cursor-pointer"
            aria-label="共有"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>share</span>
          </button>
        )}
      </div>
    );
  }

  const inQueue = mode.isInQueue(id);
  return (
    <div
      className={`flex items-center gap-3 px-4 py-[0.8rem] cursor-pointer ${
        inQueue ? 'bg-[#F0F0F0]' : ''
      }`}
      onClick={() => inQueue ? mode.onRemove(id) : mode.onAdd(item)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={pressStyle}
    >
      <div
        className="flex-1 min-w-0"
        onClick={e => { e.stopPropagation(); onPreview(); }}
      >
        <p className={`text-[0.8rem] font-bold leading-snug ${isPreviewActive ? 'text-black' : ''}`}>
          {label}
        </p>
        {timeRange && <p className="text-[0.7rem] font-thin text-black/40 mt-[0.2rem]">{timeRange}</p>}
      </div>
      <div className="shrink-0 w-9 h-9 flex items-center justify-center text-black/30">
        {inQueue ? (
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>check</span>
        ) : (
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>queue_music</span>
        )}
      </div>
      {onShare && (
        <button
          onClick={e => { e.stopPropagation(); onShare(); }}
          className="shrink-0 w-8 h-8 flex items-center justify-center text-black/30 cursor-pointer"
          aria-label="共有"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>share</span>
        </button>
      )}
    </div>
  );
}
