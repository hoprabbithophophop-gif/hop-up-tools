import React from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';

export function Player() {
  const { playerReady, isTransitioning } = useChapterPlaylistContext();

  return (
    <div className="relative w-full h-full bg-black">
      <div id="chapter-player" className="w-full h-full" />
      {!playerReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
          <span className="text-[0.65rem] text-white/40 uppercase tracking-widest">
            Loading...
          </span>
        </div>
      )}
      <div
        className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-300"
        style={{ opacity: isTransitioning ? 1 : 0 }}
      />
    </div>
  );
}
