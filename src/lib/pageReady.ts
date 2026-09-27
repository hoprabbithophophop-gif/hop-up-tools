import { useLayoutEffect } from "react";

// ページのデータがまだ届いていない間は、ページ移動の波（src/lib/pageWave.ts）を引かずに待ってもらう。
// 波の LOADING とページ自身の読み込み中の表示が続けて出ないようにするため。

const pending = new Set<object>();
let waiters: (() => void)[] = [];

function flush() {
  if (pending.size > 0) return;
  const w = waiters;
  waiters = [];
  w.forEach((f) => f());
}

// ready が false の間は待ってもらう。描画前に登録するので、ページが出た時点で待ちが揃っている
export function usePageReady(ready: boolean): void {
  useLayoutEffect(() => {
    if (ready) return;
    const token = {};
    pending.add(token);
    return () => {
      pending.delete(token);
      flush();
    };
  }, [ready]);
}

export function pageDataReady(): Promise<void> {
  return pending.size === 0 ? Promise.resolve() : new Promise((r) => waiters.push(r));
}
