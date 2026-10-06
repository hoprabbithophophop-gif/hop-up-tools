import type { PlacedItem } from './types';
import { validatePlacement } from './engine';

// 型の案内: 今の盤に足すと盤が整う語の「長さ」と「決まっている字の位置」を出す。単語は出さない
// 置ける条件は engine.ts の validatePlacement をそのまま使う。候補の作り方は findPlacement と同じ
// （新しい語は、自分と逆向きの語のマスを少なくとも1つ通る）

export interface ShapeFixed {
  index: number; // 0 始まり
  char: string;
}

// 盤の上の1本の線（置ける・点数つき）
export interface ShapeCandidate {
  length: number;
  fixed: ShapeFixed[];
  direction: 'horizontal' | 'vertical';
  startX: number;
  startY: number;
  score: number;
  width: number;
  height: number;
  filled: number;
}

// 画面に出す1行
export interface ShapeGuide {
  kind: 'multi' | 'single'; // multi = 決まっている字が2つ以上・長さは「N文字以上（M文字まで）」／single = 「N文字・M文字目がX」
  positions: number[]; // 決まっている字の位置（0 始まり）
  alts: string[][]; // 位置ごとの字（字だけ違う型をまとめた時は複数）
  minLength: number;
  maxLength: number;
  score: number;
  members: ShapeCandidate[]; // この行にまとめた線（各型で一番点数の良い長さ）
  lengthsByKey: Record<string, number[]>; // 型ごとの置ける長さ（確かめ用）
}

export const SUGGEST_MIN_LEN = 3;
export const SUGGEST_MAX_LEN = 8;
export const SUGGEST_LIMIT = 3;
export const SUGGEST_MIN_WORDS = 3;
const EMPTY = '\u0000';

// 詰まり×2 + 正方形らしさ×1
export const boardScore = (width: number, height: number, filled: number): number => {
  if (width <= 0 || height <= 0) return 0;
  return (filled / (width * height)) * 2 + Math.min(width, height) / Math.max(width, height);
};

interface CellInfo {
  char: string;
  h: boolean;
  v: boolean;
}

const cellsOf = (items: PlacedItem[]) => {
  const map = new Map<string, CellInfo>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    for (let i = 0; i < it.length; i++) {
      const x = it.direction === 'horizontal' ? it.startX + i : it.startX;
      const y = it.direction === 'vertical' ? it.startY + i : it.startY;
      const key = `${x},${y}`;
      let c = map.get(key);
      if (!c) {
        c = { char: it.answer[i], h: false, v: false };
        map.set(key, c);
      }
      if (it.direction === 'horizontal') c.h = true;
      else c.v = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { map, minX, minY, maxX, maxY };
};

// 字の位置と字の組（長さは含めない）
export const fixedKey = (fixed: ShapeFixed[]): string => fixed.map((f) => `${f.index}=${f.char}`).join(',');

export const currentBoardScore = (items: PlacedItem[]): number => {
  if (items.length === 0) return 0;
  const { map, minX, minY, maxX, maxY } = cellsOf(items);
  return boardScore(maxX - minX + 1, maxY - minY + 1, map.size);
};

// 置ける線を全部挙げる（点数が今の盤より低い物も含む）
export const listCandidates = (items: PlacedItem[]): ShapeCandidate[] => {
  if (items.length === 0) return [];
  const { map, minX, minY, maxX, maxY } = cellsOf(items);
  const seenLine = new Set<string>();
  const out: ShapeCandidate[] = [];

  for (const [key, cell] of map) {
    const [ax, ay] = key.split(',').map(Number);
    // 横の語のマスからは縦の候補、縦の語のマスからは横の候補（findPlacement と同じ）
    const dirs: ('horizontal' | 'vertical')[] = [];
    if (cell.v) dirs.push('horizontal');
    if (cell.h) dirs.push('vertical');

    for (const dir of dirs) {
      for (let len = SUGGEST_MIN_LEN; len <= SUGGEST_MAX_LEN; len++) {
        for (let j = 0; j < len; j++) {
          const sx = dir === 'horizontal' ? ax - j : ax;
          const sy = dir === 'vertical' ? ay - j : ay;
          const lineKey = `${dir}:${sx},${sy}:${len}`;
          if (seenLine.has(lineKey)) continue;
          seenLine.add(lineKey);

          const answer: string[] = [];
          const fixed: ShapeFixed[] = [];
          let lx = minX, ly = minY, hx = maxX, hy = maxY;
          for (let i = 0; i < len; i++) {
            const x = dir === 'horizontal' ? sx + i : sx;
            const y = dir === 'vertical' ? sy + i : sy;
            const c = map.get(`${x},${y}`);
            if (c) {
              answer.push(c.char);
              fixed.push({ index: i, char: c.char });
            } else {
              answer.push(EMPTY);
            }
            if (x < lx) lx = x;
            if (y < ly) ly = y;
            if (x > hx) hx = x;
            if (y > hy) hy = y;
          }

          const candidate: PlacedItem = {
            id: '', question: '', uuid: '', answer, direction: dir, startX: sx, startY: sy, length: len,
          };
          if (!validatePlacement(candidate, items)) continue;

          const width = hx - lx + 1, height = hy - ly + 1, filled = map.size + (len - fixed.length);
          const score = boardScore(width, height, filled);
          out.push({ length: len, fixed, direction: dir, startX: sx, startY: sy, score, width, height, filled });
        }
      }
    }
  }
  return out;
};

const better = (a: ShapeCandidate, b: ShapeCandidate) =>
  b.score - a.score || a.length - b.length;

export const suggestGuides = (
  items: PlacedItem[],
  limit: number = SUGGEST_LIMIT,
  minWords: number = SUGGEST_MIN_WORDS,
): ShapeGuide[] => {
  if (items.length < minWords) return [];
  const base = currentBoardScore(items);
  const all = listCandidates(items);

  // 決まっている字が2つ以上: 字の位置と字の組ごとに、長さをまとめる
  const groups = new Map<string, { fixed: ShapeFixed[]; lengths: Set<number>; best: ShapeCandidate }>();
  for (const c of all) {
    if (c.fixed.length < 2) continue;
    const k = fixedKey(c.fixed);
    const g = groups.get(k);
    if (!g) groups.set(k, { fixed: c.fixed, lengths: new Set([c.length]), best: c });
    else {
      g.lengths.add(c.length);
      if (better(c, g.best) < 0) g.best = c;
    }
  }
  const multi = [...groups.values()]
    .filter((g) => g.best.score > base + 1e-9)
    .map((g) => ({ ...g, min: Math.min(...g.lengths), max: Math.max(...g.lengths), key: fixedKey(g.fixed) }))
    .sort((a, b) =>
      b.best.score - a.best.score ||
      a.fixed.length - b.fixed.length ||
      a.min - b.min ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (multi.length > 0) {
    const out: (ShapeGuide & { base: string[]; vary: number })[] = [];
    for (const g of multi) {
      const positions = g.fixed.map((f) => f.index);
      const chars = g.fixed.map((f) => f.char);
      // 字の位置・長さの幅が同じで、1か所だけ字が違う行にまとめる
      const host = out.find((e) => {
        if (e.minLength !== g.min || e.maxLength !== g.max) return false;
        if (e.positions.join(',') !== positions.join(',')) return false;
        const diff = chars.map((ch, i) => (ch === e.base[i] ? -1 : i)).filter((i) => i >= 0);
        return diff.length === 1 && (e.vary === -1 || e.vary === diff[0]);
      });
      if (host) {
        const i = chars.findIndex((ch, idx) => ch !== host.base[idx]);
        host.vary = i;
        if (!host.alts[i].includes(chars[i])) host.alts[i].push(chars[i]);
        host.members.push(g.best);
        host.lengthsByKey[g.key] = [...g.lengths].sort((a, b) => a - b);
        continue;
      }
      if (out.length >= limit) continue;
      out.push({
        kind: 'multi', positions, alts: chars.map((ch) => [ch]), minLength: g.min, maxLength: g.max,
        score: g.best.score, members: [g.best], lengthsByKey: { [g.key]: [...g.lengths].sort((a, b) => a - b) },
        base: chars, vary: -1,
      });
    }
    return out.map(({ base: _b, vary: _v, ...rest }) => rest);
  }

  // 2つ以上の型が無い時だけ: 1つの候補を「N文字・M文字目がX」で。字だけ違う物は「／」でまとめる
  const singles = all.filter((c) => c.fixed.length === 1 && c.score > base + 1e-9);
  if (singles.length === 0) return [];
  singles.sort((a, b) => better(a, b) || (fixedKey(a.fixed) < fixedKey(b.fixed) ? -1 : 1));
  const top = singles[0];
  const same = singles.filter((c) => c.length === top.length && c.fixed[0].index === top.fixed[0].index);
  const alts: string[] = [];
  const members: ShapeCandidate[] = [];
  for (const c of same) {
    if (alts.includes(c.fixed[0].char)) continue;
    alts.push(c.fixed[0].char);
    members.push(c);
  }
  return [{
    kind: 'single', positions: [top.fixed[0].index], alts: [alts], minLength: top.length, maxLength: top.length,
    score: top.score, members, lengthsByKey: Object.fromEntries(members.map((m) => [fixedKey(m.fixed), [m.length]])),
  }];
};

// multi:「1文字目がア・3文字目がンの3文字以上の言葉（8文字まで）」／幅が無い時は「3文字の言葉」
// single:「4文字・1文字目がグ／チ／ハ」
export const formatGuide = (g: Pick<ShapeGuide, 'kind' | 'positions' | 'alts' | 'minLength' | 'maxLength'>): string => {
  const parts = g.positions.map((p, i) => `${p + 1}文字目が${g.alts[i].join('／')}`);
  if (g.kind === 'single') return [`${g.minLength}文字`, ...parts].join('・');
  const len = g.minLength === g.maxLength
    ? `${g.minLength}文字の言葉`
    : `${g.minLength}文字以上の言葉（${g.maxLength}文字まで）`;
  return `${parts.join('・')}の${len}`;
};

// ---- 段階2: 置けなかった語が入るようになる型（1つの型に入れる語は1つ・語ごとに1行） ----

export interface GuideNeed {
  index: number; // 新しい語の何文字目（0 始まり）の空きに
  word: string; // 置けなかった語
  letters: string[]; // その空きに入れてよい、その語の字
}

export interface EnterGuide {
  kind: 'enter';
  positions: number[];
  alts: string[][];
  minLength: number;
  maxLength: number;
  needs: GuideNeed[]; // 1つだけ
  entered: string[]; // 1つだけ
  density: number;
  square: number;
  members: (ShapeCandidate & { assign: { index: number; char: string }[] })[];
  lengthsByKey: Record<string, number[]>;
}

// 置けなかった語1つぶんの行。guide が null なら「入る型がありません」の行
export interface WordGuideLine {
  word: string;
  guide: EnterGuide | null;
}

export interface BoardGuide {
  mode: 'none' | 'shape' | 'enter';
  shapes: ShapeGuide[]; // 置けなかった語が無い盤（段階1）
  lines: WordGuideLine[]; // 置けなかった語ごと（入力順）
  placeableNow: string[]; // 新しい語が無くても今の盤にそのまま置ける、置けなかった語（組み立てが見落とした物）
}

export const NO_ENTER_TEXT = '今の盤に交差できる字が無く、入る型がありません';

const other = (d: 'horizontal' | 'vertical') => (d === 'horizontal' ? 'vertical' : 'horizontal');

const wordAt = (answer: string[], dir: 'horizontal' | 'vertical', px: number, py: number, k: number): PlacedItem => ({
  id: '', question: '', uuid: '', answer, direction: dir,
  startX: dir === 'horizontal' ? px - k : px,
  startY: dir === 'vertical' ? py - k : py,
  length: answer.length,
});

const cellOf = (c: ShapeCandidate, i: number) => ({
  x: c.direction === 'horizontal' ? c.startX + i : c.startX,
  y: c.direction === 'vertical' ? c.startY + i : c.startY,
});

export const tentativeItem = (c: ShapeCandidate, assign: { index: number; char: string }[] = []): PlacedItem => {
  const answer = Array.from({ length: c.length }, (_, i) =>
    c.fixed.find((f) => f.index === i)?.char ?? assign.find((a) => a.index === i)?.char ?? EMPTY);
  return { id: '', question: '', uuid: '', answer, direction: c.direction, startX: c.startX, startY: c.startY, length: c.length };
};

const wordText = (w: { answer: string[] }) => w.answer.join('');

export const suggestForBoard = (
  items: PlacedItem[],
  unplaced: { answer: string[] }[],
  limit: number = SUGGEST_LIMIT,
  minWords: number = SUGGEST_MIN_WORDS,
): BoardGuide => {
  if (items.length < minWords) return { mode: 'none', shapes: [], lines: [], placeableNow: [] };
  if (unplaced.length === 0) {
    const shapes = suggestGuides(items, limit, minWords);
    return { mode: shapes.length ? 'shape' : 'none', shapes, lines: [], placeableNow: [] };
  }

  // 新しい語が無くても、今の盤にそのまま置けるか（engine の判定で、交わる場所を全部試す）
  const cells = cellsOf(items).map;
  const placeableNow = unplaced.filter((u) => {
    for (const [key, cell] of cells) {
      const [x, y] = key.split(',').map(Number);
      const dirs: ('horizontal' | 'vertical')[] = [];
      if (cell.v) dirs.push('horizontal');
      if (cell.h) dirs.push('vertical');
      for (const d of dirs) for (let k = 0; k < u.answer.length; k++) {
        if (u.answer[k] !== cell.char) continue;
        if (validatePlacement(wordAt(u.answer, d, x, y, k), items)) return true;
      }
    }
    return false;
  }).map(wordText);

  // 空きのマスに、置けなかった語の k 文字目を交わらせて置けるか。新しい語とはそのマス1つでしか交わらないので、
  // そのマスに字を1つ置いた盤で engine の判定をすれば足りる。判定は置く語の通るマスしか見ないので、
  // そのマスに掛かる語だけを渡しても結果は同じ（速さのため）
  // 字1つの語の向きは、その字を通る新しい語（置く語と逆の向き）にそろえる（同じ向きの語が通るマスに置かない判定が、自分の字で断らないように）
  const dot = (x: number, y: number, ch: string, d: 'horizontal' | 'vertical'): PlacedItem => ({ id: '', question: '', uuid: '', answer: [ch], direction: d, startX: x, startY: y, length: 1 });
  const itemsAtCell = new Map<string, PlacedItem[]>();
  for (const it of items) for (let i = 0; i < it.length; i++) {
    const key = it.direction === 'horizontal' ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`;
    const list = itemsAtCell.get(key);
    if (list) list.push(it);
    else itemsAtCell.set(key, [it]);
  }
  const touching = (w: PlacedItem): PlacedItem[] => {
    const set = new Set<PlacedItem>();
    for (let i = 0; i < w.length; i++) {
      const key = w.direction === 'horizontal' ? `${w.startX + i},${w.startY}` : `${w.startX},${w.startY + i}`;
      for (const it of itemsAtCell.get(key) ?? []) set.add(it);
    }
    return [...set];
  };
  const ksAt = (u: { answer: string[] }, x: number, y: number, d: 'horizontal' | 'vertical'): number[] => {
    const ks: number[] = [];
    for (let k = 0; k < u.answer.length; k++) {
      const w = wordAt(u.answer, d, x, y, k);
      if (validatePlacement(w, [...touching(w), dot(x, y, u.answer[k], other(d))])) ks.push(k);
    }
    return ks;
  };

  const candidates = listCandidates(items);
  type Member = EnterGuide['members'][number];
  type G = { fixed: ShapeFixed[]; need: GuideNeed; lengths: Set<number>; best: Member; density: number; square: number; key: string };

  const lines: WordGuideLine[] = unplaced.map((u) => {
    const word = wordText(u);
    const memo = new Map<string, number[]>();
    const groups = new Map<string, G>();
    for (const c of candidates) {
      const ud = other(c.direction);
      const density = c.filled / (c.width * c.height);
      const square = Math.min(c.width, c.height) / Math.max(c.width, c.height);
      for (let b = 0; b < c.length; b++) {
        if (c.fixed.some((f) => f.index === b)) continue;
        const { x, y } = cellOf(c, b);
        const mk = `${x},${y},${ud}`;
        let ks = memo.get(mk);
        if (!ks) {
          ks = ksAt(u, x, y, ud);
          memo.set(mk, ks);
        }
        if (ks.length === 0) continue;
        const letters = [...new Set(ks.map((k) => u.answer[k]))];
        const need: GuideNeed = { index: b, word, letters };
        const key = `${fixedKey(c.fixed)}|${b}:${letters.join('')}`;
        const member: Member = { ...c, assign: [{ index: b, char: u.answer[ks[0]] }] };
        const g = groups.get(key);
        if (!g) groups.set(key, { fixed: c.fixed, need, lengths: new Set([c.length]), best: member, density, square, key });
        else {
          g.lengths.add(c.length);
          if (density > g.density + 1e-12 || (Math.abs(density - g.density) < 1e-12 && square > g.square + 1e-12)) {
            g.best = member;
            g.density = density;
            g.square = square;
          }
        }
      }
    }
    if (groups.size === 0) return { word, guide: null };

    const sorted = [...groups.values()].sort((a, b) =>
      b.density - a.density ||
      b.square - a.square ||
      a.fixed.length - b.fixed.length ||
      Math.min(...a.lengths) - Math.min(...b.lengths) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const top = sorted[0];
    const positions = top.fixed.map((f) => f.index);
    const base = top.fixed.map((f) => f.char);
    const min = Math.min(...top.lengths), max = Math.max(...top.lengths);
    const needKey = top.key.slice(top.key.indexOf('|') + 1);
    const guide: EnterGuide = {
      kind: 'enter', positions, alts: base.map((ch) => [ch]), minLength: min, maxLength: max,
      needs: [top.need], entered: [word], density: top.density, square: top.square,
      members: [top.best], lengthsByKey: { [top.key]: [...top.lengths].sort((a, b) => a - b) },
    };
    // 字の位置・長さの幅・空きの位置が同じで、1か所だけ字が違う型は「／」で同じ行にまとめる
    let vary = -1;
    for (const g of sorted.slice(1)) {
      if (g.key.slice(g.key.indexOf('|') + 1) !== needKey) continue;
      if (Math.min(...g.lengths) !== min || Math.max(...g.lengths) !== max) continue;
      if (g.fixed.map((f) => f.index).join(',') !== positions.join(',')) continue;
      const diff = g.fixed.map((f, i) => (f.char === base[i] ? -1 : i)).filter((i) => i >= 0);
      if (diff.length !== 1 || (vary !== -1 && vary !== diff[0])) continue;
      vary = diff[0];
      if (!guide.alts[vary].includes(g.fixed[vary].char)) guide.alts[vary].push(g.fixed[vary].char);
      guide.members.push(g.best);
      guide.lengthsByKey[g.key] = [...g.lengths].sort((a, b) => a - b);
    }
    return { word, guide };
  });

  return { mode: 'enter', shapes: [], lines, placeableNow };
};

// 「3文字目がエ・5文字目にエグチサヤの字の5文字以上の言葉（8文字まで）」
export const formatEnterGuide = (g: Pick<EnterGuide, 'positions' | 'alts' | 'minLength' | 'maxLength' | 'needs'>): string => {
  const parts: { at: number; text: string }[] = [
    ...g.positions.map((p, i) => ({ at: p, text: `${p + 1}文字目が${g.alts[i].join('／')}` })),
    ...g.needs.map((n) => {
      const every = Array.from(n.word).every((ch) => n.letters.includes(ch));
      return { at: n.index, text: `${n.index + 1}文字目に${n.word}の字${every ? '' : `（${n.letters.join('／')}）`}` };
    }),
  ].sort((a, b) => a.at - b.at);
  const len = g.minLength === g.maxLength
    ? `${g.minLength}文字の言葉`
    : `${g.minLength}文字以上の言葉（${g.maxLength}文字まで）`;
  return `${parts.map((p) => p.text).join('・')}の${len}`;
};

// 「エグチサヤ: 3文字目がエ・…の言葉（8文字まで）」／「エグチサヤ: 今の盤に交差できる字が無く、入る型がありません」
export const formatWordLine = (l: WordGuideLine): string =>
  `${l.word}: ${l.guide ? formatEnterGuide(l.guide) : NO_ENTER_TEXT}`;

// 画面に出す行（段階1の型か、置けなかった語ごとの行）
export const guideTexts = (b: BoardGuide): string[] =>
  b.mode === 'enter' ? b.lines.map(formatWordLine) : b.shapes.map(formatGuide);
