// HarmonyPalette が framer-motion 11.18.2 で付けていた動きを、同じ式・同じ既定値で再現するための道具。
// 新しい部品は入れず、framer-motion の dist/es のソースの式を写して、ブラウザの Web Animations で動かす。
// 写した元: animation/generators/spring/{index,defaults,find}.mjs, generators/keyframes.mjs,
//           animation/utils/default-transitions.mjs, is-transition-defined.mjs, interfaces/motion-value.mjs,
//           animators/AcceleratedAnimation.mjs（10ms ごとに区切って直線でつなぐ作り方）, easing/ease.mjs, cubic-bezier.mjs

// ---- spring（framer-motion の spring generator と同じ式） ----

export const springDefaults = {
  stiffness: 100,
  damping: 10,
  mass: 1.0,
  velocity: 0.0,
  restSpeed: { granular: 0.01, default: 2 },
  restDelta: { granular: 0.005, default: 0.5 },
};

export interface SpringOptions {
  from: number;
  to: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number; // 単位/秒（framer の options.velocity と同じ）
  restSpeed?: number;
  restDelta?: number;
}

export interface GeneratorState {
  done: boolean;
  value: number;
}

const msToS = (ms: number) => ms / 1000;
const sToMs = (s: number) => s * 1000;

const calcAngularFreq = (undampedFreq: number, dampingRatio: number) =>
  undampedFreq * Math.sqrt(1 - dampingRatio * dampingRatio);

const velocityPerSecond = (v: number, frameDuration: number) => (frameDuration ? v * (1000 / frameDuration) : 0);
const calcGeneratorVelocity = (resolve: (t: number) => number, t: number, current: number) => {
  const prevT = Math.max(t - 5, 0);
  return velocityPerSecond(current - resolve(prevT), t - prevT);
};

// t はミリ秒。戻り値は framer の generator.next(t) と同じ
export function spring(opts: SpringOptions): { next: (t: number) => GeneratorState } {
  const origin = opts.from;
  const target = opts.to;
  const stiffness = opts.stiffness ?? springDefaults.stiffness;
  const damping = opts.damping ?? springDefaults.damping;
  const mass = opts.mass ?? springDefaults.mass;
  const velocity = -msToS(opts.velocity || 0);
  let { restSpeed, restDelta } = opts;
  const state: GeneratorState = { done: false, value: origin };
  const initialVelocity = velocity || 0.0;
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const initialDelta = target - origin;
  const undampedAngularFreq = msToS(Math.sqrt(stiffness / mass));
  const isGranularScale = Math.abs(initialDelta) < 5;
  restSpeed ||= isGranularScale ? springDefaults.restSpeed.granular : springDefaults.restSpeed.default;
  restDelta ||= isGranularScale ? springDefaults.restDelta.granular : springDefaults.restDelta.default;

  let resolveSpring: (t: number) => number;
  if (dampingRatio < 1) {
    const angularFreq = calcAngularFreq(undampedAngularFreq, dampingRatio);
    resolveSpring = (t) => {
      const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
      return target - envelope *
        (((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) / angularFreq) * Math.sin(angularFreq * t) +
          initialDelta * Math.cos(angularFreq * t));
    };
  } else if (dampingRatio === 1) {
    resolveSpring = (t) => target - Math.exp(-undampedAngularFreq * t) *
      (initialDelta + (initialVelocity + undampedAngularFreq * initialDelta) * t);
  } else {
    const dampedAngularFreq = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
    resolveSpring = (t) => {
      const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
      const freqForT = Math.min(dampedAngularFreq * t, 300);
      return target - (envelope *
        ((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) * Math.sinh(freqForT) +
          dampedAngularFreq * initialDelta * Math.cosh(freqForT))) / dampedAngularFreq;
    };
  }
  const rs = restSpeed, rd = restDelta;
  return {
    next: (t) => {
      const current = resolveSpring(t);
      let currentVelocity = 0.0;
      if (dampingRatio < 1) {
        currentVelocity = t === 0 ? sToMs(initialVelocity) : calcGeneratorVelocity(resolveSpring, t, current);
      }
      state.done = Math.abs(currentVelocity) <= rs && Math.abs(target - current) <= rd;
      state.value = state.done ? target : current;
      return state;
    },
  };
}

// ---- 緩急の曲線（framer の cubicBezier と同じ解き方） ----

const calcBezier = (t: number, a1: number, a2: number) =>
  (((1.0 - 3.0 * a2 + 3.0 * a1) * t + (3.0 * a2 - 6.0 * a1)) * t + 3.0 * a1) * t;

export function cubicBezier(mX1: number, mY1: number, mX2: number, mY2: number): (t: number) => number {
  if (mX1 === mY1 && mX2 === mY2) return (t) => t;
  const getTForX = (aX: number) => {
    let lowerBound = 0, upperBound = 1, currentX: number, currentT: number, i = 0;
    do {
      currentT = lowerBound + (upperBound - lowerBound) / 2.0;
      currentX = calcBezier(currentT, mX1, mX2) - aX;
      if (currentX > 0.0) upperBound = currentT;
      else lowerBound = currentT;
    } while (Math.abs(currentX) > 0.0000001 && ++i < 12);
    return currentT;
  };
  return (t) => (t === 0 || t === 1 ? t : calcBezier(getTForX(t), mY1, mY2));
}

export type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut" | [number, number, number, number];
const EASES: Record<string, [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};
const easeFn = (e: Ease) => (e === "linear" ? (t: number) => t : cubicBezier(...(Array.isArray(e) ? e : EASES[e])));

// framer の keyframes generator（区間ごとに緩急をかけ、区間は等間隔）
function tween(values: number[], durationMs: number, ease: Ease, times?: number[]) {
  const f = easeFn(ease);
  const offs = times && times.length === values.length ? times : values.map((_, i) => (values.length === 1 ? 0 : i / (values.length - 1)));
  const abs = offs.map((o) => o * durationMs);
  return {
    next: (t: number): GeneratorState => {
      let value: number;
      if (t <= abs[0]) value = values[0];
      else if (t >= abs[abs.length - 1]) value = values[values.length - 1];
      else {
        let i = 1;
        while (i < abs.length - 1 && t > abs[i]) i++;
        const span = abs[i] - abs[i - 1];
        const p = span === 0 ? 1 : (t - abs[i - 1]) / span;
        value = values[i - 1] + (values[i] - values[i - 1]) * f(Math.min(1, Math.max(0, p)));
      }
      return { done: t >= durationMs, value };
    },
  };
}

// ---- 動きの指定（framer の transition と同じ書き方。時間は秒） ----

export interface Transition {
  type?: "spring" | "tween" | "keyframes";
  duration?: number;
  delay?: number;
  ease?: Ease;
  times?: number[];
  stiffness?: number;
  damping?: number;
  mass?: number;
  restSpeed?: number;
  restDelta?: number;
  velocity?: number;
}

export type MotionProp = "opacity" | "scale" | "rotate" | "x" | "y";
export type MotionValue = number | string; // "100%" のような単位つきも可
export type MotionTarget = Partial<Record<MotionProp, MotionValue | MotionValue[]>>;

// framer の getDefaultTransition（transition を何も書かなかった値に付く既定の動き）
export function defaultTransition(prop: MotionProp, keyframes: number[]): Transition {
  if (keyframes.length > 2) return { type: "keyframes", duration: 0.8 };
  if (prop === "scale") {
    const target = keyframes[1];
    return { type: "spring", stiffness: 550, damping: target === 0 ? 2 * Math.sqrt(550) : 30, restSpeed: 10 };
  }
  if (prop === "x" || prop === "y" || prop === "rotate") return { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 };
  return { type: "keyframes", ease: [0.25, 0.1, 0.35, 1], duration: 0.3 };
}

// framer の isTransitionDefined（delay などの段取りの項目を除いて何か書いてあるか）
const isTransitionDefined = (t: Transition | undefined) =>
  !!t && Object.keys(t).some((k) => k !== "delay");

export interface Track {
  delayMs: number;
  durationMs: number; // 動きそのものの長さ（delay を除く）
  sample: (t: number) => number; // delay を除いた経過ミリ秒での値
}

// 1つの値の動きを、framer と同じ規則で組み立てる
export function buildTrack(prop: MotionProp, keyframes: number[], transition?: Transition): Track {
  const delayMs = sToMs(transition?.delay ?? 0);
  let opts: Transition = { ease: "easeOut", ...(transition ?? {}) };
  if (!isTransitionDefined(transition)) opts = { ...opts, ...defaultTransition(prop, keyframes) };
  if (opts.type === "spring") {
    const gen = spring({
      from: keyframes[0],
      to: keyframes[keyframes.length - 1],
      stiffness: opts.stiffness,
      damping: opts.damping,
      mass: opts.mass,
      velocity: opts.velocity,
      restSpeed: opts.restSpeed,
      restDelta: opts.restDelta,
    });
    // AcceleratedAnimation の pregenerateKeyframes と同じく 10ms ごとに区切り、止まった所で長さを決める
    const values: number[] = [];
    let t = 0;
    let st: GeneratorState = { done: false, value: keyframes[0] };
    while (!st.done && t < 20000) {
      st = gen.next(t);
      values.push(st.value);
      t += 10;
    }
    const durationMs = t - 10;
    return {
      delayMs,
      durationMs,
      sample: (ms) => {
        if (ms >= durationMs) return values[values.length - 1];
        const i = Math.floor(ms / 10);
        const p = (ms - i * 10) / 10;
        return values[i] + ((values[i + 1] ?? values[i]) - values[i]) * p;
      },
    };
  }
  const durationMs = sToMs(opts.duration ?? 0.3);
  const gen = tween(keyframes, durationMs, opts.ease ?? "easeOut", opts.times);
  return { delayMs, durationMs, sample: (ms) => gen.next(ms).value };
}

// ---- 画面の要素を動かす ----

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const splitUnit = (v: MotionValue): [number, string] => {
  if (typeof v === "number") return [v, ""];
  const m = v.match(/^(-?[\d.]+)(.*)$/);
  return m ? [parseFloat(m[1]), m[2]] : [0, ""];
};

const IDENTITY: Record<MotionProp, number> = { opacity: 1, scale: 1, rotate: 0, x: 0, y: 0 };

type CssProp = "opacity" | "scale" | "rotate" | "translate";
const cssPropOf = (p: MotionProp): CssProp => (p === "x" || p === "y" ? "translate" : p);

function cssValue(css: CssProp, vals: Partial<Record<MotionProp, string>>): string {
  if (css === "translate") return `${vals.x ?? "0px"} ${vals.y ?? "0px"}`;
  return vals[css as MotionProp] ?? "";
}

const fmt = (p: MotionProp, n: number, unit: string) =>
  p === "opacity" || p === "scale" ? String(n) : p === "rotate" ? `${n}deg` : `${n}${unit || "px"}`;

export interface MotionHandle {
  finished: Promise<void>;
  cancel: () => void;
}

// 見た目の値を要素に直接書く（動きの終わりや、動きを減らす設定のとき）。何もしない値は外す
export function setStyles(el: HTMLElement, values: Partial<Record<MotionProp, MotionValue>>) {
  const byCss: Partial<Record<CssProp, Partial<Record<MotionProp, string>>>> = {};
  const identityCss = new Set<CssProp>(["opacity", "scale", "rotate", "translate"]);
  const present = new Set<CssProp>();
  (Object.keys(values) as MotionProp[]).forEach((p) => {
    const [n, unit] = splitUnit(values[p]!);
    const css = cssPropOf(p);
    present.add(css);
    (byCss[css] ||= {})[p] = fmt(p, n, unit);
    if (n !== IDENTITY[p]) identityCss.delete(css);
  });
  present.forEach((css) => {
    const s = el.style as unknown as Record<string, string>;
    s[css] = identityCss.has(css) ? "" : cssValue(css, byCss[css]!);
  });
}

// from から to へ動かす。to が配列なら keyframes。値ごとに transition を変えたいときは perProp に書く
export function animateElement(
  el: HTMLElement,
  from: Partial<Record<MotionProp, MotionValue>>,
  to: MotionTarget,
  transition?: Transition,
  perProp?: Partial<Record<MotionProp, Transition>>,
  measure?: (p: MotionProp, v: MotionValue) => MotionValue
): MotionHandle {
  const props = (Object.keys(to) as MotionProp[]);
  const finalValues: Partial<Record<MotionProp, MotionValue>> = {};
  const tracks: { p: MotionProp; unit: string; track: Track }[] = [];
  props.forEach((p) => {
    const raw = to[p]!;
    let frames: MotionValue[] = Array.isArray(raw) ? [...raw] : [from[p] ?? IDENTITY[p], raw];
    if (Array.isArray(raw) && from[p] !== undefined && raw.length === 1) frames = [from[p]!, raw[0]];
    // 単位をそろえる（framer と同じく 0 は相手の単位に、それ以外の食い違いは測って px に）
    const units = frames.map((f) => splitUnit(f)[1]);
    const nonZeroUnits = new Set(frames.filter((f) => splitUnit(f)[0] !== 0).map((f) => splitUnit(f)[1]));
    let unit = units.find((u) => u) ?? "";
    if (nonZeroUnits.size > 1 && measure) {
      frames = frames.map((f) => (splitUnit(f)[1] === "%" ? measure(p, f) : f));
      unit = "px";
    }
    const nums = frames.map((f) => splitUnit(f)[0]);
    tracks.push({ p, unit, track: buildTrack(p, nums, perProp?.[p] ?? transition) });
    finalValues[p] = `${nums[nums.length - 1]}${unit}`;
  });

  if (prefersReducedMotion() || typeof el.animate !== "function") {
    setStyles(el, finalValues);
    return { finished: Promise.resolve(), cancel: () => {} };
  }

  // 同じ CSS の項目（x と y は translate）ごとに 1 本の Web Animation にまとめる
  const groups = new Map<CssProp, typeof tracks>();
  tracks.forEach((t) => {
    const c = cssPropOf(t.p);
    groups.set(c, [...(groups.get(c) ?? []), t]);
  });
  const anims: Animation[] = [];
  groups.forEach((list, css) => {
    const total = Math.max(...list.map((t) => t.track.delayMs + t.track.durationMs), 1);
    const kfs: Keyframe[] = [];
    for (let ms = 0; ; ms += 10) {
      const at = Math.min(ms, total);
      const vals: Partial<Record<MotionProp, string>> = {};
      list.forEach(({ p, unit, track }) => {
        const local = at - track.delayMs;
        vals[p] = fmt(p, local <= 0 ? track.sample(0) : track.sample(local), unit);
      });
      kfs.push({ offset: at / total, [css]: cssValue(css, vals) } as Keyframe);
      if (at >= total) break;
    }
    anims.push(el.animate(kfs, { duration: total, easing: "linear", fill: "both" }));
  });
  let cancelled = false;
  const finished = Promise.all(anims.map((a) => a.finished)).then(
    () => {
      if (cancelled) return;
      setStyles(el, finalValues);
      anims.forEach((a) => a.cancel());
    },
    () => {}
  );
  return {
    finished,
    cancel: () => {
      cancelled = true;
      anims.forEach((a) => a.cancel());
    },
  };
}

// 動いている途中の今の値（framer の「今の値から」動き出す場面用）。translate / scale / rotate / opacity を読む
export function currentValue(el: HTMLElement, p: MotionProp): number {
  const cs = getComputedStyle(el) as unknown as Record<string, string>;
  if (p === "opacity") return parseFloat(cs.opacity || "1");
  if (p === "scale") return cs.scale && cs.scale !== "none" ? parseFloat(cs.scale) : 1;
  if (p === "rotate") return cs.rotate && cs.rotate !== "none" ? parseFloat(cs.rotate) : 0;
  const tr = cs.translate && cs.translate !== "none" ? cs.translate.split(" ") : [];
  return parseFloat((p === "x" ? tr[0] : tr[1]) ?? "0") || 0;
}
