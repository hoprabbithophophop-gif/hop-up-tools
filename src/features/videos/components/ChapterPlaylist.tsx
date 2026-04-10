import React, { useEffect, useRef } from 'react';
import { useChapterPlaylistContext } from '../context/ChapterPlaylistContext';
import { ChapterPlaylistItem } from './ChapterPlaylistItem';

export function ChapterPlaylist() {
  const { state, jumpTo, removeFromQueue } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentIndex]);

  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-[0.65rem] text-outline uppercase tracking-widest">
        キューが空です
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 divide-y divide-outline-variant/10">
      {queue.map((item, i) => (
        <div key={item.id} ref={i === currentIndex ? activeRef : null}>
          <ChapterPlaylistItem
            item={item}
            index={i}
            isActive={i === currentIndex}
            onPlay={() => jumpTo(i)}
            onRemove={() => removeFromQueue(item.id)}
          />
        </div>
      ))}
    </div>
  );
}
