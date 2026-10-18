import type { PuzzleItem, PlacedItem } from './types';
import { tryPlaceAll, shuffleByLength, buildGrid, findPlacement, SEARCH_TIME_LIMIT_MS } from './engine';

// 「まとめて入れる」で、読みの付いた語の中から盤に収まる組み合わせを探し、上位いくつかを作る人に並べるための仕組み。
// 新しい置き方は書かず、作る画面の組み立てと同じ tryPlaceAll を何度も回して、出来た盤を比べるだけにしている
// （選んだ盤をそのまま作る画面の盤として使うので、置き方の決まりが組み立てとずれないように）。

export interface BulkProposal {
  placed: PlacedItem[];
  width: number;
  height: number;
  /** 字の入るマスの数（重なりは1つに数える） */
  cells: number;
  /** 2語が重なるマスの数 */
  crossings: number;
  leftOut: PuzzleItem[];
}

export interface BulkSearch {
  /** budgetMs のあいだ試行を回す（画面が固まらないよう、呼ぶ側が刻んで呼ぶ） */
  step: (budgetMs: number) => void;
  /** 上位 N 個 */
  proposals: () => BulkProposal[];
  /** 時間の上限に達したか、全部の語が入る盤が N 個そろった */
  finished: () => boolean;
  attempts: () => number;
  elapsedMs: () => number;
}

// 比べるために覚えておく提案の数の上限。毎回の試行を全部残すと語が多い時にふくらむので、順位の低い物から捨てる。
// 上位 N の「語の組が違う物」を選ぶ余地を残すため、N よりかなり多めにしてある【仮】
const KEEP_LIMIT = 200;

// 順位【仮】: 入った語が多い方 → 交差が多い方（語どうしがよく絡んで解きやすい）→ マスが少ない方（盤が締まる）
// → 盤の面積が小さい方（ここまで同じ物は字の数も同じなので、作る画面の組み立てと同じく面積の小さい方を上にする）
const compareProposals = (a: BulkProposal, b: BulkProposal): number =>
  b.placed.length - a.placed.length || b.crossings - a.crossings || a.cells - b.cells || a.width * a.height - b.width * b.height;

const wordSetKey = (placed: PlacedItem[]): string => placed.map((p) => p.id).sort().join('\u0000');

// 同じ提案の見分け【仮】: 置けた語の組＋盤の大きさ＋交差数が同じなら、作る人から見て同じ盤とみなす
const proposalKey = (p: BulkProposal): string => `${wordSetKey(p.placed)}|${p.width}x${p.height}|${p.crossings}`;

const toProposal = (placed: PlacedItem[], pool: PuzzleItem[]): BulkProposal => {
  const g = buildGrid(placed);
  const on = new Set(placed.map((p) => p.id));
  return {
    placed,
    width: g.width,
    height: g.height,
    cells: g.cells.length,
    crossings: g.cells.filter((c) => (c.wordIds?.length ?? 0) >= 2).length,
    leftOut: pool.filter((i) => !on.has(i.id)),
  };
};

// 上位 N の選び方【仮】: 順位どおりに取るが、入った語の数が同じ物の中では、まだ選んでいない語の組を先に取る
// （同じ語の組で大きさ違いだけが並ぶと、作る人にとって選ぶ意味が薄いため）。
// 入った語の数をまたいでまで語の組の違いを優先しないのは、語が多く入る盤を少ない盤より下に回さないため
const pickTop = (sorted: BulkProposal[], top: number): BulkProposal[] => {
  const picked: BulkProposal[] = [];
  const usedSets = new Set<string>();
  const taken = new Set<BulkProposal>();
  let i = 0;
  while (picked.length < top && i < sorted.length) {
    const tier = sorted[i].placed.length;
    let j = i;
    while (j < sorted.length && sorted[j].placed.length === tier) j++;
    const group = sorted.slice(i, j);
    for (const p of group) {
      if (picked.length >= top) break;
      const k = wordSetKey(p.placed);
      if (usedSets.has(k)) continue;
      usedSets.add(k);
      taken.add(p);
      picked.push(p);
    }
    for (const p of group) {
      if (picked.length >= top) break;
      if (taken.has(p)) continue;
      taken.add(p);
      picked.push(p);
    }
    i = j;
  }
  return picked;
};

export const createBulkSearch = (
  pool: PuzzleItem[],
  opts: { top?: number; timeLimitMs?: number; now?: () => number } = {}
): BulkSearch => {
  const top = opts.top ?? 3;
  const timeLimitMs = opts.timeLimitMs ?? SEARCH_TIME_LIMIT_MS;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  const store = new Map<string, BulkProposal>();
  let attempts = 0;
  let startedAt: number | null = null;
  let fullCount = 0;
  // 1語は置き方が1通りしかないので、回し続けても新しい提案は出ない
  let single = false;

  const spent = () => (startedAt === null ? 0 : now() - startedAt);
  const finished = () => pool.length === 0 || single || fullCount >= top || spent() >= timeLimitMs;

  const add = (placed: PlacedItem[]) => {
    if (placed.length === 0) return;
    const p = toProposal(placed, pool);
    const key = proposalKey(p);
    if (store.has(key)) return;
    store.set(key, p);
    if (p.placed.length === pool.length) fullCount++;
    if (store.size > KEEP_LIMIT) {
      // 一番順位の低い物を捨てる。全部入る盤は数えた数とずれないよう捨てない（上限より多く全部入る盤が貯まる前に終わる）
      let worstKey: string | null = null;
      let worst: BulkProposal | null = null;
      for (const [k, v] of store) {
        if (v.placed.length === pool.length) continue;
        if (!worst || compareProposals(v, worst) > 0) { worst = v; worstKey = k; }
      }
      if (worstKey) store.delete(worstKey);
    }
  };

  return {
    step: (budgetMs: number) => {
      const t0 = now();
      if (startedAt === null) startedAt = t0;
      if (pool.length === 1 && !single) {
        const one = findPlacement(pool[0], []);
        attempts++;
        if (one) add([one]);
        single = true;
        return;
      }
      while (!finished() && now() - t0 < budgetMs) {
        add(tryPlaceAll(shuffleByLength(pool), true));
        attempts++;
      }
    },
    proposals: () => pickTop([...store.values()].sort(compareProposals), top),
    finished,
    attempts: () => attempts,
    elapsedMs: spent,
  };
};
