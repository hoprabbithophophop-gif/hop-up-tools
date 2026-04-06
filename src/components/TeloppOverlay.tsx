/**
 * TeloppOverlay - 動画撮影用テロップオーバーレイ
 *
 * 使い方:
 * - window.setTelopp('テキスト') でテロップを表示
 * - window.clearTelopp() でテロップを非表示
 */
import { useState, useEffect } from 'react';

declare global {
  interface Window {
    setTelopp: (text: string) => void;
    clearTelopp: () => void;
  }
}

export default function TeloppOverlay() {
  const [text, setText] = useState('');

  useEffect(() => {
    window.setTelopp = (newText: string) => setText(newText);
    window.clearTelopp = () => setText('');
    return () => {
      // @ts-expect-error cleanup
      delete window.setTelopp;
      // @ts-expect-error cleanup
      delete window.clearTelopp;
    };
  }, []);

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Zen+Kurenaido&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  if (!text) return null;

  return (
    <div className="fixed bottom-32 left-0 right-0 z-[99999] flex justify-center pointer-events-none">
      <div
        style={{
          fontFamily: '"Zen Kurenaido", cursive',
          fontWeight: 400,
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          color: '#1a1a1a',
          border: '2px solid rgba(0, 0, 0, 0.1)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          maxWidth: '90vw',
          textAlign: 'center',
          padding: '0.75rem 1.5rem',
          borderRadius: '0.5rem',
          fontSize: '1.125rem',
        }}
      >
        {text}
      </div>
    </div>
  );
}
