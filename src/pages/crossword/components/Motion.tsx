// framer-motion の motion.div / AnimatePresence の代わり。
// initial → animate を出たときに、exit を消えるときに、HarmonyPalette と同じ値で動かす（式は src/lib/crossword/motion.ts）。
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  animateElement,
  currentValue,
  setStyles,
  type MotionHandle,
  type MotionProp,
  type MotionTarget,
  type MotionValue,
  type Transition,
} from "../../../lib/crossword/motion";

type Values = Partial<Record<MotionProp, MotionValue>>;

// 消えていく途中の子に配る合図。exit を持つ子は登録し、全員の動きが終わったら外す
interface PresenceCtx {
  exiting: boolean;
  register: () => { done: () => void; unregister: () => void }; // done = 動き終わりの合図
}
const PresenceContext = createContext<PresenceCtx | null>(null);

// AnimatePresence と同じく、外れた子を exit の動きが終わるまで残す（元の並び位置のまま）
export function Presence({ children }: { children: ReactNode }) {
  const [, force] = useState(0);
  const current: { key: string; el: ReactElement }[] = [];
  Children.forEach(children, (c) => {
    if (isValidElement(c)) current.push({ key: String(c.key ?? current.length), el: c });
  });
  const prev = useRef<{ key: string; el: ReactElement }[]>([]);
  const exiting = useRef(new Map<string, ReactElement>());

  const keys = new Set(current.map((c) => c.key));
  keys.forEach((k) => exiting.current.delete(k));
  prev.current.forEach((p) => {
    if (!keys.has(p.key) && !exiting.current.has(p.key)) exiting.current.set(p.key, p.el);
  });
  // 並びは前回の並びを土台にし、新しく出た子は今の位置に差し込む
  const merged: { key: string; el: ReactElement; exiting: boolean }[] = [];
  prev.current.forEach((p) => {
    const now = current.find((c) => c.key === p.key);
    if (now) merged.push({ ...now, exiting: false });
    else if (exiting.current.has(p.key)) merged.push({ key: p.key, el: exiting.current.get(p.key)!, exiting: true });
  });
  current.forEach((c, i) => {
    if (!merged.some((m) => m.key === c.key)) merged.splice(Math.min(i, merged.length), 0, { ...c, exiting: false });
  });
  prev.current = merged.map(({ key, el }) => ({ key, el }));

  const remove = (key: string) => {
    if (!exiting.current.has(key)) return;
    exiting.current.delete(key);
    prev.current = prev.current.filter((p) => p.key !== key);
    force((n) => n + 1);
  };

  return (
    <>
      {merged.map((it) => (
        <PresenceChild key={it.key} exiting={it.exiting} onDone={() => remove(it.key)}>
          {it.el}
        </PresenceChild>
      ))}
    </>
  );
}

function PresenceChild({ exiting, onDone, children }: { exiting: boolean; onDone: () => void; children: ReactNode }) {
  const pending = useRef(new Set<object>());
  const finishedSet = useRef(new Set<object>());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const exitingRef = useRef(exiting);
  exitingRef.current = exiting;
  const check = () => {
    if (!exitingRef.current) return;
    for (const t of pending.current) if (!finishedSet.current.has(t)) return;
    doneRef.current();
  };
  const ctx: PresenceCtx = {
    exiting,
    register: () => {
      const token = {};
      pending.current.add(token);
      return {
        done: () => {
          finishedSet.current.add(token);
          check();
        },
        // 外れた子（開発時の StrictMode の二度呼びを含む）は待たない
        unregister: () => {
          pending.current.delete(token);
          finishedSet.current.delete(token);
        },
      };
    },
  };
  useEffect(() => {
    if (!exiting) {
      finishedSet.current.clear();
      return;
    }
    // exit を持つ子が1つも無ければすぐ外す
    if (pending.current.size === 0) doneRef.current();
  }, [exiting]);
  return <PresenceContext.Provider value={ctx}>{children}</PresenceContext.Provider>;
}

type PerProp = Partial<Record<MotionProp, Transition>>;

export interface MotionProps extends HTMLAttributes<HTMLDivElement> {
  initial?: Values;
  animate?: MotionTarget;
  exit?: MotionTarget;
  transition?: Transition;
  transitionPerProp?: PerProp;
  exitTransition?: Transition;
  exitPerProp?: PerProp;
  // exit を「今の値」から始めるときの今の値（ドラッグで動いた後など）
  exitFrom?: () => Values;
  measure?: (p: MotionProp, v: MotionValue) => MotionValue;
  style?: CSSProperties;
  children?: ReactNode;
}

// motion.div と同じく、出たときに initial → animate、Presence の中で外れたときに exit を動かす
export const Motion = forwardRef<HTMLDivElement, MotionProps>(function Motion(
  { initial, animate, exit, transition, transitionPerProp, exitTransition, exitPerProp, exitFrom, measure, children, ...rest },
  outerRef
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(outerRef, () => ref.current as HTMLDivElement);
  const presence = useContext(PresenceContext);
  const handle = useRef<MotionHandle | null>(null);
  const lastValues = useRef<Values>({});
  const doneExit = useRef<(() => void) | null>(null);

  // exit を持つ子は、Presence に「消えるまで待って」と登録する
  useLayoutEffect(() => {
    if (!presence || !exit) return;
    const reg = presence.register();
    doneExit.current = reg.done;
    return () => {
      doneExit.current = null;
      reg.unregister();
    };
  }, []);

  const animateKey = JSON.stringify(animate ?? null);
  const started = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !animate) return;
    const from: Values = { ...lastValues.current };
    if (!started.current && initial) {
      Object.assign(from, initial);
      setStyles(el, initial);
    }
    started.current = true;
    const h = animateElement(el, from, animate, transition, transitionPerProp, measure);
    handle.current = h;
    const last: Values = {};
    (Object.keys(animate) as MotionProp[]).forEach((p) => {
      const v = animate[p]!;
      last[p] = Array.isArray(v) ? v[v.length - 1] : v;
    });
    lastValues.current = { ...lastValues.current, ...last };
    return () => {
      // 途中で止めるときは、今見えている値を残して次の動きの出発点にする
      // （animate が変わった時と、開発時の StrictMode の付け外し）
      if (handle.current !== h) return;
      const cur: Values = {};
      (Object.keys(animate) as MotionProp[]).forEach((p) => {
        cur[p] = currentValue(el, p);
      });
      h.cancel();
      handle.current = null;
      setStyles(el, cur);
      lastValues.current = { ...lastValues.current, ...cur };
    };
  }, [animateKey]);

  useLayoutEffect(() => {
    if (!presence?.exiting || !exit) return;
    const el = ref.current;
    if (!el) return;
    handle.current?.cancel();
    const from: Values = exitFrom ? exitFrom() : { ...lastValues.current };
    const h = animateElement(el, from, exit, exitTransition ?? transition, exitPerProp ?? transitionPerProp, measure);
    handle.current = h;
    // 消えるまで最後の値のままにする（動き終わりに値を外さない）
    h.finished.then(() => {
      setStyles(el, Object.fromEntries((Object.keys(exit) as MotionProp[]).map((p) => {
        const v = exit[p]!;
        return [p, Array.isArray(v) ? v[v.length - 1] : v];
      })) as Values);
      doneExit.current?.();
    });
  }, [presence?.exiting]);

  return (
    <PresenceContext.Provider value={presence}>
      <div ref={ref} {...rest}>
        {children}
      </div>
    </PresenceContext.Provider>
  );
});
