import React from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';

function IconBtn({
  icon,
  onClick,
  active,
  toggle,
  label,
  size = 24,
}: {
  icon: string;
  onClick: () => void;
  active?: boolean;
  /** true のとき ON/OFF の視覚的トグルとして扱う（inactive = グレー） */
  toggle?: boolean;
  label: string;
  size?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-11 h-11 flex items-center justify-center transition-colors cursor-pointer ${
        toggle
          ? active
            ? 'text-on-surface'
            : 'text-outline hover:text-on-surface'
          : active
          ? 'text-primary'
          : 'text-on-surface hover:text-primary'
      }`}
    >
      <span className="material-symbols-outlined leading-none" style={{ fontSize: `${size}px` }}>
        {icon}
      </span>
    </button>
  );
}

export function PlayControls() {
  const {
    state,
    playNext,
    playPrev,
    toggleShuffle,
    toggleRepeat,
    pause,
    resume,
    jumpTo,
  } = useChapterPlaylistContext();

  const { queue, currentIndex, isPlaying, isShuffled, repeatMode } = state;

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else if (currentIndex === null && queue.length > 0) {
      jumpTo(0);
    } else {
      resume();
    }
  };

  return (
    <div className="flex items-center justify-center gap-1">
      <IconBtn
        icon="repeat"
        onClick={toggleRepeat}
        active={repeatMode === 'all'}
        toggle
        label="リピート"
        size={22}
      />
      <IconBtn
        icon="skip_previous"
        onClick={playPrev}
        label="前のキュー項目"
        size={28}
      />
      <button
        onClick={handlePlayPause}
        aria-label={isPlaying ? '一時停止' : '再生'}
        className="w-12 h-12 flex items-center justify-center bg-black text-white cursor-pointer hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: '28px' }}>
          {isPlaying ? 'pause' : 'play_arrow'}
        </span>
      </button>
      <IconBtn
        icon="skip_next"
        onClick={playNext}
        label="次のキュー項目"
        size={28}
      />
      <IconBtn
        icon="shuffle"
        onClick={toggleShuffle}
        active={isShuffled}
        toggle
        label="シャッフル"
        size={22}
      />
    </div>
  );
}
