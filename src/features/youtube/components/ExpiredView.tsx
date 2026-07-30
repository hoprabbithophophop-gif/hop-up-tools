import React from 'react';
import { Link } from 'react-router-dom';

export function ExpiredView() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-widest text-black/30 mb-2">Expired</p>
        <p className="text-sm font-bold text-black mb-1">期限切れ</p>
        <p className="text-xs text-black/40 mb-6">
          このプレイリストの共有URLは有効期限が切れました
        </p>
        <Link
          to="/youtube"
          className="inline-block px-6 py-2.5 text-xs font-bold uppercase tracking-widest bg-black text-white hover:opacity-90 transition-opacity"
        >
          HELLO! VIDEOに戻る
        </Link>
      </div>
    </div>
  );
}
