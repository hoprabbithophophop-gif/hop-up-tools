/**
 * 返事の後に流す書き込み（waitUntil の中身）の失敗を、黙って捨てずに console.error に残す。
 * 投げられた失敗も、返事が 2xx でない失敗も残す。利用者への返事には影響しない。
 */
export function logBackground(label: string, ...tasks: Promise<unknown>[]): Promise<void> {
  return Promise.allSettled(tasks).then((results) => {
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error(`${label}: background task ${i} threw`, String(r.reason));
      else if (r.value instanceof Response && !r.value.ok) console.error(`${label}: background task ${i} failed`, r.value.status);
    });
  });
}
