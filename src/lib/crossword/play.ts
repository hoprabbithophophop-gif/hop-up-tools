// 解いている回の受付係（/api/crossword-play）とのやり取り。答えはブラウザに来ないので、丸付けと1文字見るはここを通す。
import { getPlayerKey } from "./scores";
export class PlayError extends Error {
  constructor(public reason: string) {
    super(`play failed: ${reason}`);
  }
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new PlayError("network");
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: unknown } & T;
  if (res.ok && data.ok) return data;
  throw new PlayError(typeof data.reason === "string" ? data.reason : "server");
}

// 回を始める。タイムは受付係の時計で、この時から解けるまでを測る
export const startPlay = (puzzleId: string) => call<{ token: string; startedAt: number }>({ action: "start", puzzleId });

export interface CheckResult {
  correct: boolean;
  /** 合っていた時だけ。カギの並び順の答え */
  answers?: string[][];
  /** 合っていた時だけ。受付係の時計で測ったタイム（秒） */
  timeSeconds?: number;
  /** 合っていた時だけ。人間には無理な速さで解けた回は false（ランキングに載せない） */
  rankable?: boolean;
}

// 答案を丸付けしてもらう。合っていなければ、どこが違うかは返ってこない
// waitedMs = 最後の字のあと答え合わせまで待った時間（開いていた時間のミリ秒）。解けた時に受付係がタイムから引く（最大2秒）
export const checkPlay = (token: string, answers: Record<string, string>, waitedMs = 0) =>
  call<CheckResult>({ action: "check", token, answers, waitedMs });

// 最初の1文字が入ったことを知らせる。遊ばれた回数は受付係がこの回で1度だけ数える
// deviceId は端末の見分け用の番号（ランキングで使っている物と同じ）。遊ばれた回数を端末ごとに数えるために送る（Hop 決定 2026-10-27。受付係は touch で受け取る）
export const touchPlay = (token: string) => call<{ counted: boolean }>({ action: "touch", token, deviceId: getPlayerKey() });

// そのマスの字を1つ教えてもらう。reveals はこの回で見たマスの数
export const revealCell = (token: string, x: number, y: number) => call<{ char: string; reveals: number }>({ action: "reveal", token, x, y });

// 盤を開いていた時間（Hop 決定 2026-10-07）。タイムは受付係が測る「盤を開いていた時間の合計」。
// activeMs はその合計（ミリ秒）。open は受付係から見て今盤が開いているか
export interface ActiveTime {
  activeMs: number;
  open: boolean;
}

// 盤を開いた（再開）。受付係が開き始めの時刻を書く
export const resumePlay = (token: string) => call<ActiveTime>({ action: "resume", token });

// 盤を閉じた・一時停止
export const pausePlay = (token: string) => call<ActiveTime>({ action: "pause", token });

// 開いている間の生存の合図（60秒ごと）
export const pingPlay = (token: string) => call<ActiveTime>({ action: "ping", token });

// 画面を閉じる・隠す時の一時停止。返事は待てないので sendBeacon で送る（送れなければ fetch の keepalive で送る）
export function pausePlayBeacon(token: string): void {
  const body = JSON.stringify({ action: "pause", token });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon("/api/crossword-play", new Blob([body], { type: "application/json" }))) return;
    }
  } catch {
    /* 下の fetch で送る */
  }
  try {
    void fetch("/api/crossword-play", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* 送れなくても受付係が最後の生存の合図で打ち切る */
  }
}
