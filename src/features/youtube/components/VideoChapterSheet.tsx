import React, { useMemo, useEffect, useState } from 'react';
import { makeChapterId, buildChapterQueueItems, buildFullVideoQueueItem, formatSeconds } from '../../videos/utils/playlist-utils';
import type { ChapterQueueItem } from '../../videos/types/playlist';

interface VideoForSheet {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  description_short: string;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

function parseChapters(description: string): Chapter[] {
  if (!description) return [];
  const re = /^(\d{1,2}):(\d{2})(?::(\d{2}))?[～〜\s\-]+(.+)$/gm;
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

      {/* シートパネル（デスクトップは最大幅制限+センタリング） */}
      <div className="w-full max-w-lg mx-auto">
      <div className="relative bg-surface rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* ハンドルバー */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-outline-variant/40" />
        </div>

        {/* 動画情報ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/20 shrink-0">
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-16 shrink-0 object-cover"
            style={{ height: '36px', aspectRatio: '16/9' }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[0.75rem] font-bold leading-snug line-clamp-2">{video.title}</p>
            <p className="text-[0.625rem] text-outline mt-0.5">{video.channel_name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-outline hover:text-on-surface transition-colors cursor-pointer shrink-0"
            aria-label="閉じる"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>close</span>
          </button>
        </div>

        {/* アクションバー（選択モード時：全選択ボタン） */}
        {mode.kind === 'selection' && chapterItems.length > 0 && (
          <div className="px-4 py-2 border-b border-outline-variant/10 shrink-0 flex items-center justify-between">
            <p className="text-[0.6rem] text-outline uppercase tracking-widest">
              {chapters.length}チャプター
            </p>
            <button
              onClick={() => mode.onSelectAll(chapterItems)}
              className="text-[0.6875rem] font-bold uppercase tracking-widest text-primary hover:opacity-70 transition-opacity cursor-pointer"
            >
              全て選択
            </button>
          </div>
        )}

        {/* ミニプレビュー（吹き出し） */}
        {previewItem && (
          <div className="shrink-0 px-4 pt-3 border-b border-outline-variant/20 bg-surface">
            <div className="bg-black rounded overflow-hidden shadow-xl">
              {/* ヘッダー */}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="material-symbols-outlined leading-none text-white/50 shrink-0" style={{ fontSize: '14px' }}>
                  play_circle
                </span>
                <p className="flex-1 min-w-0 text-white text-[0.625rem] font-bold truncate">
                  {previewItem.chapterLabel}
                </p>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="shrink-0 text-white/50 hover:text-white transition-colors cursor-pointer"
                  aria-label="プレビューを閉じる"
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>close</span>
                </button>
              </div>
              {/* YouTube iframe */}
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
            {/* 吹き出し矢印（下向き → リストを指す） */}
            <div className="flex justify-center mt-0 pb-0">
              <div style={{
                width: 0, height: 0,
                borderLeft: '9px solid transparent',
                borderRight: '9px solid transparent',
                borderTop: '8px solid black',
              }} />
            </div>
          </div>
        )}

        {/* チャプターリスト */}
        <div className="overflow-y-auto flex-1">
          {/* 全編再生 */}
          <ChapterRow
            id={fullVideoItem.id}
            label={fullVideoItem.chapterLabel}
            timestamp=""
            timeRange="全編再生"
            mode={mode}
            item={fullVideoItem}
            isFullVideo
            onPreview={() => setPreviewItem(fullVideoItem)}
            isPreviewActive={previewItem?.id === fullVideoItem.id}
          />

          {chapterItems.length === 0 && (
            <p className="px-4 py-4 text-[0.6875rem] text-outline">
              チャプター情報がありません
            </p>
          )}

          {chapterItems.map(item => (
            <ChapterRow
              key={item.id}
              id={item.id}
              label={item.chapterLabel}
              timestamp={item.chapterTimestamp}
              timeRange={`${formatSeconds(item.startSeconds)}${
                isFinite(item.endSeconds) && item.endSeconds !== Number.MAX_SAFE_INTEGER
                  ? ` — ${formatSeconds(item.endSeconds)}`
                  : ''
              }`}
              mode={mode}
              item={item}
              isFullVideo={false}
              onPreview={() => setPreviewItem(item)}
              isPreviewActive={previewItem?.id === item.id}
            />
          ))}

          {/* 下部余白 */}
          <div className="h-6" />
        </div>
      </div>
      </div>
    </div>
  );
}

interface ChapterRowProps {
  id: string;
  label: string;
  timestamp: string;
  timeRange: string;
  mode: SheetMode;
  item: ChapterQueueItem;
  isFullVideo: boolean;
  onPreview: () => void;
  isPreviewActive: boolean;
}

function ChapterRow({ id, label, timestamp, timeRange, mode, item, isFullVideo, onPreview, isPreviewActive }: ChapterRowProps) {
  if (mode.kind === 'selection') {
    const num = mode.getSelectionNumber(id);
    const isSelected = num > 0;
    return (
      <div
        onClick={() => mode.onToggle(id, item)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && mode.onToggle(id, item)}
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-b border-outline-variant/10 ${
          isSelected ? 'bg-black/5' : 'hover:bg-surface-container-low'
        }`}
      >
        {/* タイトルエリア（タップでプレビュー、選択は伝播しない） */}
        <div
          className="flex-1 min-w-0"
          onClick={e => { e.stopPropagation(); onPreview(); }}
        >
          <p className={`text-[0.8125rem] font-bold leading-snug truncate transition-colors ${
            isPreviewActive ? 'text-primary' : ''
          }`}>
            {label}
          </p>
          <p className="text-[0.625rem] font-mono text-outline/70 mt-0.5">{timeRange}</p>
        </div>
        {!isFullVideo && timestamp && (
          <span className="text-[0.625rem] font-mono text-outline shrink-0">{timestamp}</span>
        )}
        <div className="shrink-0 w-9 h-9 flex items-center justify-center">
          {isSelected ? (
            <span className="w-6 h-6 bg-black text-white flex items-center justify-center text-[0.625rem] font-bold leading-none">
              {num}
            </span>
          ) : (
            <span className="w-6 h-6 border border-outline/40 flex items-center justify-center text-outline">
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>add</span>
            </span>
          )}
        </div>
      </div>
    );
  }

  // add モード：行全体タップ = キューに追加、タイトル部分タップ = プレビュー
  const inQueue = mode.isInQueue(id);
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant/10 transition-colors ${
        inQueue ? 'bg-black/5' : 'hover:bg-surface-container-low cursor-pointer'
      }`}
      onClick={() => !inQueue && mode.onAdd(item)}
    >
      {/* タイトルエリア（タップでプレビュー・選択は伝播しない） */}
      <div
        className="flex-1 min-w-0"
        onClick={e => { e.stopPropagation(); onPreview(); }}
      >
        <p className={`text-[0.8125rem] font-bold leading-snug truncate transition-colors ${
          isPreviewActive ? 'text-primary' : ''
        }`}>
          {label}
        </p>
        <p className="text-[0.625rem] font-mono text-outline/70 mt-0.5">{timeRange}</p>
      </div>
      {!isFullVideo && timestamp && (
        <span className="text-[0.625rem] font-mono text-outline shrink-0">{timestamp}</span>
      )}
      {/* キュー状態インジケーター（視覚のみ） */}
      <div className={`shrink-0 w-9 h-9 flex items-center justify-center ${
        inQueue ? 'text-primary' : 'text-outline'
      }`}>
        <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>
          {inQueue ? 'check' : 'queue_music'}
        </span>
      </div>
    </div>
  );
}
