// ページ移動のときに画面全体を図形で覆う演出。
// 覆う → 裏でページを入れ替える → 次のページとアイコンの準備を待つ → 引く、の順で App.tsx から使う。
// 形は毎回ランダム（同じ形は続けない）、色は薄いグレーで固定。

export const WAVE_COLOR = "#d2d4d8";
const LABEL_COLOR = "#585f6c";

// 覆う・引くそれぞれの長さを見本（一覧ページ）の何倍にするか
const SPEED = 0.6;
const STD = "cubic-bezier(.4,0,.2,1)";

// 独自の演出を持つページには出さない（出入りのどちらかが該当すれば従来のフェード）
const EXCLUDED = /^\/(hi-tension|arigato-beat|hai-to-diamond)(\/|$)/;
export function isWaveExcluded(pathname: string): boolean {
  return EXCLUDED.test(pathname);
}

// 動きの仕組み（Web Animations）が無い古いブラウザでは波を出さない（出すと覆ったまま外れなくなる）
export function supportsWave(): boolean {
  return typeof Element !== "undefined" && "animate" in Element.prototype && "getAnimations" in Element.prototype;
}

// YouTube の埋め込みプレーヤーの上に図形を重ねない（YouTube API 規約: プレーヤーの前に何も表示しない）。
// 波が出ている間にプレーヤーが画面にあれば、ページ部分を空白にしておき、波が引いてから出す
const PLAYER_SELECTOR = 'iframe[src*="youtube.com/"], iframe[src*="youtube-nocookie.com/"]';
export function hasEmbeddedPlayer(area: HTMLElement): boolean {
  return area.querySelector(PLAYER_SELECTOR) !== null;
}

// 見張りを始めた時点から止めるまで、プレーヤーが現れたら次の描画より前にページ部分を空白にする
export function guardPlayers(area: HTMLElement): () => void {
  const hideIfPlayer = () => {
    if (hasEmbeddedPlayer(area)) area.style.visibility = "hidden";
  };
  hideIfPlayer();
  const mo = new MutationObserver(hideIfPlayer);
  mo.observe(area, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  return () => mo.disconnect();
}

// 空白にしていたページ部分を、波が引いたあとに出す
export function showAreaAfterWave(area: HTMLElement): void {
  if (area.style.visibility !== "hidden") return;
  area.style.visibility = "";
  area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: STD });
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function anim(el: Element, kf: Keyframe[], dur: number, easing = "linear", delay = 0): Promise<unknown> {
  return el.animate(kf, { duration: dur * SPEED, delay: delay * SPEED, easing, fill: "both" }).finished;
}

function box(parent: HTMLElement, color: string, css: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const d = document.createElement("div");
  d.style.position = "absolute";
  d.style.background = color;
  Object.assign(d.style, css);
  parent.appendChild(d);
  return d;
}

type Effect = {
  cover(f: HTMLElement, W: number, H: number, c: string): Promise<HTMLElement[]>;
  reveal(f: HTMLElement, W: number, H: number, els: HTMLElement[]): Promise<void>;
};

async function all(ps: Promise<unknown>[]) { await Promise.all(ps); }

const EFFECTS: Record<string, Effect> = {
  tiles: {
    async cover(f, W, H, c) {
      const C = 8, cw = W / C, R = Math.ceil(H / cw), els: HTMLElement[] = [];
      for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
        const e = box(f, c, { left: x * cw + "px", top: y * cw + "px", width: cw + 0.6 + "px", height: cw + 0.6 + "px", transform: "scale(0)", borderRadius: "50%" });
        e.dataset.d = String(x + y);
        els.push(e);
      }
      await all(els.map((e) => anim(e, [{ transform: "scale(0)", borderRadius: "50%" }, { transform: "scale(.6)", borderRadius: "50%", offset: 0.5 }, { transform: "scale(1)", borderRadius: "0%" }], 200, STD, +e.dataset.d! * 28)));
      return els;
    },
    async reveal(_f, _W, _H, els) {
      await all(els.map((e) => anim(e, [{ transform: "scale(1)", borderRadius: "0%" }, { transform: "scale(.6)", borderRadius: "50%", offset: 0.5 }, { transform: "scale(0)", borderRadius: "50%" }], 200, STD, +e.dataset.d! * 28)));
    },
  },
  shutter: {
    async cover(f, _W, H, c) {
      const N = 6, h = H / N;
      const els = [...Array(N)].map((_, i) => box(f, c, { left: "0", right: "0", top: i * h + "px", height: h + 1 + "px", transformOrigin: "50% 0", transform: "scaleY(0)" }));
      await all(els.map((e, i) => anim(e, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], 200, STD, i * 40)));
      return els;
    },
    async reveal(_f, _W, _H, els) {
      els.forEach((e) => (e.style.transformOrigin = "50% 100%"));
      await all(els.map((e, i) => anim(e, [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], 200, STD, i * 40)));
    },
  },
  slats: {
    async cover(f, W, H, c) {
      const S = Math.hypot(W, H) * 1.1, N = 8, h = S / N;
      const holder = document.createElement("div");
      Object.assign(holder.style, { position: "absolute", width: S + "px", height: S + "px", left: (W - S) / 2 + "px", top: (H - S) / 2 + "px", transform: "rotate(-30deg)" });
      f.appendChild(holder);
      const els = [...Array(N)].map((_, i) => box(holder, c, { left: "0", right: "0", top: i * h + "px", height: h + 1 + "px", transformOrigin: "0 50%", transform: "scaleX(0)" }));
      await all(els.map((e, i) => anim(e, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 220, STD, i * 35)));
      return els;
    },
    async reveal(_f, _W, _H, els) {
      els.forEach((e) => (e.style.transformOrigin = "100% 50%"));
      await all(els.map((e, i) => anim(e, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], 220, STD, i * 35)));
    },
  },
  iris: {
    async cover(f, W, H, c) {
      const D = Math.hypot(W, H) + 4;
      const e = box(f, "transparent", { left: "50%", top: "50%", transform: "translate(-50%,-50%)", boxSizing: "content-box", width: D + "px", height: D + "px", border: `${D}px solid ${c}`, borderRadius: "50%" });
      e.dataset.d = String(D);
      await anim(e, [{ width: D + "px", height: D + "px" }, { width: "0px", height: "0px" }], 380, "cubic-bezier(.6,0,.4,1)");
      return [e];
    },
    async reveal(_f, _W, _H, [e]) {
      const D = e.dataset.d + "px";
      await anim(e, [{ width: "0px", height: "0px" }, { width: D, height: D }], 380, "cubic-bezier(.6,0,.4,1)");
    },
  },
  square: {
    async cover(f, W, H, c) {
      const S = (W + H) * 0.75;
      const e = box(f, c, { width: S + "px", height: S + "px", left: (W - S) / 2 + "px", top: (f.clientHeight - S) / 2 + "px", transform: "rotate(0deg) scale(0)" });
      await anim(e, [{ transform: "rotate(0deg) scale(0)" }, { transform: "rotate(135deg) scale(1)" }], 400, STD);
      return [e];
    },
    async reveal(_f, _W, _H, [e]) {
      await anim(e, [{ transform: "rotate(135deg) scale(1)" }, { transform: "rotate(270deg) scale(0)" }], 400, STD);
    },
  },
  columns: {
    async cover(f, W, _H, c) {
      const N = 7, w = W / N;
      const els = [...Array(N)].map((_, i) => box(f, c, { top: "0", bottom: "0", left: i * w + "px", width: w + 1 + "px", transform: "translateY(-100%)" }));
      await all(els.map((e, i) => anim(e, [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], 260, "cubic-bezier(.55,0,1,.45)", COLUMN_ORDER[i] * 40)));
      return els;
    },
    async reveal(_f, _W, _H, els) {
      await all(els.map((e, i) => anim(e, [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], 260, "cubic-bezier(.55,0,1,.45)", COLUMN_ORDER[i] * 40)));
    },
  },
  pixels: {
    async cover(f, W, H, c) {
      const C = 12, cw = W / C, R = Math.ceil(H / cw), els: HTMLElement[] = [];
      for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) els.push(box(f, c, { left: x * cw + "px", top: y * cw + "px", width: cw + 0.6 + "px", height: cw + 0.6 + "px", opacity: "0" }));
      await all(els.map((e) => anim(e, [{ opacity: 0 }, { opacity: 1 }], 1, "steps(1,end)", Math.random() * 380)));
      return els;
    },
    async reveal(_f, _W, _H, els) {
      await all(els.map((e) => anim(e, [{ opacity: 1 }, { opacity: 0 }], 1, "steps(1,end)", Math.random() * 380)));
    },
  },
  doors: {
    async cover(f, _W, _H, c) {
      const l = box(f, c, { top: "0", bottom: "0", left: "0", width: "50.5%", transform: "translateX(-100%)" });
      const r = box(f, c, { top: "0", bottom: "0", right: "0", width: "50.5%", transform: "translateX(100%)" });
      const e = "cubic-bezier(.7,0,.3,1)";
      await all([anim(l, [{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }], 280, e), anim(r, [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], 280, e)]);
      return [l, r];
    },
    async reveal(_f, _W, _H, [l, r]) {
      const e = "cubic-bezier(.7,0,.3,1)";
      await all([anim(l, [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }], 280, e), anim(r, [{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], 280, e)]);
    },
  },
  halftone: {
    async cover(f, W, H, c) {
      const C = 9, cw = W / C, R = Math.ceil(H / cw) + 1, cx = W / 2, cy = f.clientHeight / 2, far = Math.hypot(cx, cy), els: HTMLElement[] = [];
      for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
        const px = x * cw + cw / 2, py = y * cw + cw / 2;
        const e = box(f, c, { left: px - cw * 0.75 + "px", top: py - cw * 0.75 + "px", width: cw * 1.5 + "px", height: cw * 1.5 + "px", borderRadius: "50%", transform: "scale(0)" });
        e.dataset.d = String(Math.hypot(px - cx, py - cy) / far);
        els.push(e);
      }
      await all(els.map((e) => anim(e, [{ transform: "scale(0)" }, { transform: "scale(1)" }], 220, STD, +e.dataset.d! * 320)));
      return els;
    },
    async reveal(_f, _W, _H, els) {
      await all(els.map((e) => anim(e, [{ transform: "scale(1)" }, { transform: "scale(0)" }], 220, STD, +e.dataset.d! * 320)));
    },
  },
};
const COLUMN_ORDER = [3, 1, 5, 0, 6, 2, 4];

let lastEffect = "";

export type WaveCover = { effect: Effect; els: HTMLElement[] };

// 図形を並べる高さ。iPhone の Safari は途中でツールバーが出入りして画面の高さが変わるので、
// 画面そのものの高さまで余分に覆っておく
function coverHeight(layer: HTMLElement): number {
  return Math.max(layer.clientHeight, window.innerHeight, window.screen?.height ?? 0);
}

// 画面を覆う。instant のときは動きなしで一瞬で覆う（サイトを開いた最初の1回用）
export async function coverScreen(layer: HTMLElement, instant = false): Promise<WaveCover> {
  const names = Object.keys(EFFECTS).filter((n) => n !== lastEffect);
  const name = names[Math.floor(Math.random() * names.length)];
  lastEffect = name;
  const effect = EFFECTS[name];
  layer.style.pointerEvents = "auto";
  const pending = effect.cover(layer, layer.clientWidth, coverHeight(layer), WAVE_COLOR);
  if (instant) layer.getAnimations({ subtree: true }).forEach((a) => a.finish());
  return { effect, els: await pending };
}

export async function revealScreen(layer: HTMLElement, cover: WaveCover): Promise<void> {
  await cover.effect.reveal(layer, layer.clientWidth, coverHeight(layer), cover.els);
  layer.replaceChildren();
  layer.style.pointerEvents = "none";
}

// 覆っている間、準備（ready）が済むまで待つ。0.4秒を超えたら LOADING を出す。最長 capMs で打ち切る
export async function holdUntilReady(layer: HTMLElement, ready: Promise<unknown>, capMs = 1500): Promise<void> {
  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "absolute", inset: "0", display: "grid", placeItems: "center",
    fontSize: "11px", fontWeight: "700", letterSpacing: "0.2em", color: LABEL_COLOR,
    opacity: "0", zIndex: "1",
  });
  label.textContent = "LOADING";
  layer.appendChild(label);
  const t = setTimeout(() => (label.style.opacity = "1"), 400);
  await Promise.race([ready.catch(() => {}), sleep(capMs)]);
  clearTimeout(t);
  label.remove();
}

// アイコンのフォントの準備。読み込み済みならすぐ終わる
export function iconFontReady(): Promise<unknown> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return document.fonts.load('24px "Material Symbols Outlined"');
}
