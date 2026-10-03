// 解いている回の受付係（/api/crossword-play）とのやり取り。答えはブラウザに来ないので、丸付けと1文字見るはここを通す。
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
}

// 答案を丸付けしてもらう。合っていなければ、どこが違うかは返ってこない
export const checkPlay = (token: string, answers: Record<string, string>) => call<CheckResult>({ action: "check", token, answers });

// そのマスの字を1つ教えてもらう。reveals はこの回で見たマスの数
export const revealCell = (token: string, x: number, y: number) => call<{ char: string; reveals: number }>({ action: "reveal", token, x, y });
