import React from 'react';
import { Link } from 'react-router-dom';

export function ExpiredView() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-4xl mb-4">⏰</p>
        <p className="text-sm font-bold text-on-surface mb-1">期限切れ</p>
        <p className="text-xs text-outline mb-6">
          このプレイリストの共有URLは有効期限が切れました
        </p>
        <Link
          to="/youtube"
          className="inline-block px-6 py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-white hover:opacity-90 transition-opacity"
        >
          ピックアップ画面へ →
        </Link>
      </div>
    </div>
  );
}
