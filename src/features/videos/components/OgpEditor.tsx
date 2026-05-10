import React, { useEffect, useRef, useState } from 'react';
import type { ChapterQueueItem } from '../types/playlist';

type FabricModule = typeof import('fabric');
type FabricCanvas = InstanceType<FabricModule['Canvas']>;

const CANVAS_W = 1200;
const CANVAS_H = 630;
const HISTORY_MAX = 50;
const SNAP_THRESHOLD = 8;
const CUSTOM_PROPS = ['__isTitle', '__isYT', '__isDrawing', '__textId'];

const FONTS = [
  { label: 'ゴシック', family: 'Noto Sans JP', weight: 700 },
  { label: '明朝', family: 'Noto Serif JP', weight: 700 },
  { label: '丸ゴ', family: 'M PLUS Rounded 1c', weight: 700 },
  { label: 'ドット', family: 'DotGothic16', weight: 400 },
  { label: '手書き', family: 'Yusei Magic', weight: 400 },
] as const;

const FONT_CSS_URLS = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap',
  'https://fonts.googleapis.com/css2?family=Yusei+Magic&display=swap',
];

const BG_COLORS = [
  { label: 'ブルー', value: '#6ba6ff' },
  { label: 'ピンク', value: '#ff6b9d' },
  { label: 'グリーン', value: '#8bc34a' },
  { label: 'オレンジ', value: '#ffb74d' },
  { label: 'グレー', value: '#e1e3e4' },
  { label: '黒', value: '#000000' },
  { label: '白', value: '#ffffff' },
] as const;

type TabId = 'text' | 'style' | 'bg' | 'element' | 'output';
const TABS: { id: TabId; label: string }[] = [
  { id: 'text', label: '文字' },
  { id: 'style', label: '装飾' },
  { id: 'bg', label: '背景' },
  { id: 'element', label: '要素' },
  { id: 'output', label: '書出' },
];

interface SliderDef {
  id: string;
  label: string;
  prop: string;
  min: number;
  max: number;
  step: number;
  toValue: (raw: number) => number;
  fromValue: (real: number) => number;
  display: (raw: number) => string;
}

const SLIDERS: SliderDef[] = [
  { id: 'rotate', label: '回転', prop: 'angle', min: -45, max: 45, step: 1,
    toValue: v => v, fromValue: v => v, display: v => `${v}°` },
  { id: 'skewX', label: '斜め（横歪み）', prop: 'skewX', min: -45, max: 45, step: 1,
    toValue: v => v, fromValue: v => v, display: v => `${v}°` },
  { id: 'skewY', label: '歪み（縦歪み）', prop: 'skewY', min: -45, max: 45, step: 1,
    toValue: v => v, fromValue: v => v, display: v => `${v}°` },
  { id: 'scaleX', label: '横の太さ', prop: 'scaleX', min: -50, max: 100, step: 5,
    toValue: v => 1 + v / 100, fromValue: v => (v - 1) * 100, display: v => `${(1 + v / 100).toFixed(2)}x` },
  { id: 'scaleY', label: '縦の高さ', prop: 'scaleY', min: -50, max: 100, step: 5,
    toValue: v => 1 + v / 100, fromValue: v => (v - 1) * 100, display: v => `${(1 + v / 100).toFixed(2)}x` },
];

interface OgpEditorProps {
  title: string;
  queue: ChapterQueueItem[];
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
}

async function loadFonts(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  FONT_CSS_URLS.forEach(href => {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  });
  const total = FONTS.length;
  let loaded = 0;
  await Promise.all(FONTS.map(f =>
    document.fonts.load(`${f.weight} 40px "${f.family}"`).then(() => {
      loaded++;
      onProgress?.(loaded, total);
    }).catch(() => {
      loaded++;
      onProgress?.(loaded, total);
    })
  ));
  if (document.fonts?.ready) await document.fonts.ready;
  const tmp = document.createElement('canvas');
  tmp.width = 100; tmp.height = 100;
  const ctx = tmp.getContext('2d');
  if (ctx) FONTS.forEach(f => { ctx.font = `${f.weight} 40px "${f.family}"`; ctx.fillText('あ', 10, 50); });
}

const SLIDER_CSS = `
.ogp-slider input[type="range"]{-webkit-appearance:none;appearance:none;width:100%;height:24px;background:transparent;margin:0}
.ogp-slider input[type="range"]::-webkit-slider-runnable-track{height:2px;background:#c6c6c6}
.ogp-slider input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;height:20px;width:20px;background:#000;margin-top:-9px;cursor:pointer}
.ogp-slider input[type="range"]::-moz-range-track{height:2px;background:#c6c6c6}
.ogp-slider input[type="range"]::-moz-range-thumb{height:20px;width:20px;background:#000;border:0;cursor:pointer}
.ogp-slider input[type="range"]:disabled::-webkit-slider-thumb{background:#c6c6c6;cursor:not-allowed}
.ogp-slider input[type="range"]:disabled::-moz-range-thumb{background:#c6c6c6;cursor:not-allowed}
`;

export function OgpEditor({ title, queue, onDone, onCancel }: OgpEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const fabricModuleRef = useRef<FabricModule | null>(null);

  const [loading, setLoading] = useState(true);
  const [fontProgress, setFontProgress] = useState('0 / 5');
  const [activeTab, setActiveTab] = useState<TabId>('text');

  const [textInput, setTextInput] = useState(title);
  const [textDisabled, setTextDisabled] = useState(true);
  const [selectedFont, setSelectedFont] = useState('Noto Sans JP');
  const [selectedInfo, setSelectedInfo] = useState('未選択');
  const [selectedActive, setSelectedActive] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>(
    { rotate: 0, skewX: 0, skewY: 0, scaleX: 0, scaleY: 0 }
  );

  const [shadowOn, setShadowOn] = useState(false);
  const [shadowColor, setShadowColor] = useState('#000000');
  const [shadowBlur, setShadowBlur] = useState(10);
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [neonOn, setNeonOn] = useState(false);
  const [neonColor, setNeonColor] = useState('#ff6b9d');
  const [gradOn, setGradOn] = useState(false);
  const [gradColor1, setGradColor1] = useState('#ff6b9d');
  const [gradColor2, setGradColor2] = useState('#6ba6ff');
  const [textColor, setTextColor] = useState('#000000');

  const [drawingMode, setDrawingMode] = useState(false);
  const [brushColor, setBrushColor] = useState('#ff6b9d');
  const [brushWidth, setBrushWidth] = useState(8);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const textIdCounterRef = useRef(1);
  const historyRef = useRef<string[]>([]);
  const historyPointerRef = useRef(-1);
  const isUndoRedoingRef = useRef(false);
  const guideLinesRef = useRef<unknown[]>([]);

  // ===== Helpers (safe to capture in init: only use refs + setState) =====

  function isTextObj(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') && !o.__isYT;
  }

  function getSelText(): Record<string, unknown> | null {
    const c = fabricRef.current;
    if (!c) return null;
    const obj = c.getActiveObject();
    return isTextObj(obj) ? (obj as unknown as Record<string, unknown>) : null;
  }

  function saveState() {
    if (isUndoRedoingRef.current) return;
    const c = fabricRef.current;
    if (!c || (c as any).isDrawingMode) return;
    const state = JSON.stringify((c as any).toObject(CUSTOM_PROPS));
    historyRef.current = historyRef.current.slice(0, historyPointerRef.current + 1);
    historyRef.current.push(state);
    if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift();
    historyPointerRef.current = historyRef.current.length - 1;
    setCanUndo(historyPointerRef.current > 0);
    setCanRedo(false);
  }

  function syncSelection(canvas: FabricCanvas) {
    const obj = canvas.getActiveObject();
    if (isTextObj(obj)) {
      const o = obj as unknown as Record<string, unknown>;
      setTextInput(o.text as string);
      setTextDisabled(false);
      setSelectedFont(o.fontFamily as string);
      setSelectedInfo(o.__isTitle ? '選択中：タイトル' : '選択中：テキスト');
      setSelectedActive(true);
      const vals: Record<string, number> = {};
      SLIDERS.forEach(s => {
        const cur = (o[s.prop] as number) ?? (s.prop.startsWith('scale') ? 1 : 0);
        vals[s.id] = Math.round(s.fromValue(cur));
      });
      setSliderValues(vals);
    } else if (obj) {
      setTextInput(''); setTextDisabled(true);
      setSelectedInfo('選択中：サムネ'); setSelectedActive(true);
      setSliderValues({ rotate: 0, skewX: 0, skewY: 0, scaleX: 0, scaleY: 0 });
    } else {
      setTextInput(''); setTextDisabled(true);
      setSelectedInfo('未選択（要素をタップ / + テキスト追加で新規）'); setSelectedActive(false);
      setSliderValues({ rotate: 0, skewX: 0, skewY: 0, scaleX: 0, scaleY: 0 });
    }
  }

  function clearGuides() {
    const c = fabricRef.current;
    if (!c) return;
    guideLinesRef.current.forEach(g => { try { c.remove(g as any); } catch { /* */ } });
    guideLinesRef.current = [];
  }

  function resizeCanvas(canvas: FabricCanvas) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = w * (CANVAS_H / CANVAS_W);
    wrap.style.height = `${h}px`;
    canvas.setDimensions({ width: w, height: h }, { cssOnly: false } as never);
    canvas.setZoom(w / CANVAS_W);
    canvas.renderAll();
  }

  function addInitialObjects(canvas: FabricCanvas, fabric: FabricModule) {
    const titleText = new fabric.Textbox(title || 'プレイリストタイトル', {
      left: 60, top: 80, width: 1000, fontSize: 80,
      fontFamily: 'Noto Sans JP', fontWeight: '700', fill: '#000000',
      editable: false, splitByGrapheme: false,
    });
    (titleText as any).__isTitle = true;
    (titleText as any).__textId = 'title_main';
    canvas.add(titleText);

    const positions = [{ x: 60, y: 320 }, { x: 400, y: 320 }, { x: 60, y: 500 }, { x: 400, y: 500 }];
    queue.slice(0, 4).forEach((item, i) => {
      const pos = positions[i];
      const rect = new fabric.Rect({ width: 320, height: 180, fill: '#585f6c', originX: 'left', originY: 'top' });
      const label = new fabric.Textbox(item.chapterLabel, {
        width: 300, fontSize: 20, fontFamily: 'Noto Sans JP', fill: 'white',
        fontWeight: '700', textAlign: 'center', originX: 'center', originY: 'center', left: 160, top: 90,
      });
      canvas.add(new fabric.Group([rect, label], { left: pos.x, top: pos.y }));
    });

    const yt = new fabric.FabricText('▶ YouTube', {
      left: 1040, top: 590, fontSize: 18, fontFamily: 'Noto Sans JP',
      fontWeight: '700', fill: '#000000', selectable: false, evented: false,
    });
    (yt as any).__isYT = true;
    canvas.add(yt);
  }

  // ===== Init =====
  useEffect(() => {
    let cancelled = false;

    async function init() {
      await loadFonts((loaded, total) => { if (!cancelled) setFontProgress(`${loaded} / ${total}`); });
      if (cancelled) return;

      const fabric = await import('fabric');
      if (cancelled) return;
      fabricModuleRef.current = fabric;

      const el = canvasRef.current;
      if (!el) return;

      const canvas = new fabric.Canvas(el, {
        backgroundColor: '#e1e3e4', preserveObjectStacking: true,
        width: CANVAS_W, height: CANVAS_H,
      });
      fabricRef.current = canvas;

      addInitialObjects(canvas, fabric);

      canvas.on('selection:created', () => syncSelection(canvas));
      canvas.on('selection:updated', () => syncSelection(canvas));
      canvas.on('selection:cleared', () => syncSelection(canvas));
      canvas.on('object:added', () => saveState());
      canvas.on('object:removed', () => saveState());
      canvas.on('object:modified', () => { saveState(); syncSelection(canvas); });

      canvas.on('object:moving', (e: any) => {
        clearGuides();
        const obj = e.target;
        if (!obj || (obj as any).__isYT) return;
        const fm = fabricModuleRef.current;
        if (!fm) return;
        const cx = obj.left + (obj.width * obj.scaleX) / 2;
        const cy = obj.top + (obj.height * obj.scaleY) / 2;
        const mx = CANVAS_W / 2, my = CANVAS_H / 2;
        if (Math.abs(cx - mx) < SNAP_THRESHOLD) {
          obj.set('left', mx - (obj.width * obj.scaleX) / 2);
          const l = new fm.Line([mx, 0, mx, CANVAS_H], {
            stroke: '#ff6b9d', strokeWidth: 2, strokeDashArray: [6, 6],
            selectable: false, evented: false, excludeFromExport: true,
          } as any);
          guideLinesRef.current.push(l);
          canvas.add(l);
        }
        if (Math.abs(cy - my) < SNAP_THRESHOLD) {
          obj.set('top', my - (obj.height * obj.scaleY) / 2);
          const l = new fm.Line([0, my, CANVAS_W, my], {
            stroke: '#ff6b9d', strokeWidth: 2, strokeDashArray: [6, 6],
            selectable: false, evented: false, excludeFromExport: true,
          } as any);
          guideLinesRef.current.push(l);
          canvas.add(l);
        }
      });
      canvas.on('mouse:up', () => clearGuides());

      canvas.renderAll();
      resizeCanvas(canvas);
      setTimeout(() => saveState(), 100);
      setLoading(false);
    }

    init();
    return () => { cancelled = true; fabricRef.current?.dispose(); fabricRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = () => { if (fabricRef.current) resizeCanvas(fabricRef.current); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // ===== Text handlers =====

  const handleTextChange = (value: string) => {
    setTextInput(value);
    const txt = getSelText();
    const c = fabricRef.current;
    if (txt && c) { (txt as any).set('text', value); c.renderAll(); }
  };

  const addText = (initial = '新しいテキスト') => {
    const fm = fabricModuleRef.current, c = fabricRef.current;
    if (!fm || !c) return;
    const t = new fm.Textbox(initial, {
      left: 200 + Math.random() * 200, top: 200 + Math.random() * 200,
      width: 400, fontSize: 60, fontFamily: 'Noto Sans JP', fontWeight: '700',
      fill: '#000000', editable: false, splitByGrapheme: false,
    });
    (t as any).__textId = 'text_' + textIdCounterRef.current++;
    c.add(t); c.setActiveObject(t); c.renderAll();
    syncSelection(c);
    setActiveTab('text');
  };

  const changeFont = (family: string) => {
    const txt = getSelText(), c = fabricRef.current;
    if (!txt || !c) return;
    const o = txt as any;
    o.set('fontFamily', family); o.set('dirty', true);
    if (typeof o.initDimensions === 'function') o.initDimensions();
    o.setCoords();
    setSelectedFont(family);
    c.requestRenderAll();
    setTimeout(() => { c.renderAll(); saveState(); }, 0);
  };

  // ===== Transform handlers =====

  const handleSlider = (id: string, raw: number) => {
    const txt = getSelText(), c = fabricRef.current;
    if (!txt || !c) return;
    const s = SLIDERS.find(x => x.id === id)!;
    (txt as any).set(s.prop, s.toValue(raw));
    setSliderValues(p => ({ ...p, [id]: raw }));
    c.renderAll();
  };

  const resetSlider = (id: string) => {
    const txt = getSelText(), c = fabricRef.current;
    if (!txt || !c) return;
    const s = SLIDERS.find(x => x.id === id)!;
    (txt as any).set(s.prop, s.prop.startsWith('scale') ? 1 : 0);
    setSliderValues(p => ({ ...p, [id]: 0 }));
    c.renderAll(); saveState();
  };

  const resetAllTransforms = () => {
    const txt = getSelText(), c = fabricRef.current;
    if (!txt || !c) return;
    (txt as any).set({ skewX: 0, skewY: 0, angle: 0, scaleX: 1, scaleY: 1 });
    setSliderValues({ rotate: 0, skewX: 0, skewY: 0, scaleX: 0, scaleY: 0 });
    c.renderAll(); saveState();
  };

  // ===== Effect handlers =====

  const handleShadow = (on: boolean, color?: string, blur?: number) => {
    const newOn = on, newColor = color ?? shadowColor, newBlur = blur ?? shadowBlur;
    setShadowOn(newOn);
    if (color !== undefined) setShadowColor(color);
    if (blur !== undefined) setShadowBlur(blur);
    const txt = getSelText(), c = fabricRef.current, fm = fabricModuleRef.current;
    if (!txt || !c || !fm) return;
    if (newOn) {
      (txt as any).set('shadow', new fm.Shadow({ color: newColor, blur: newBlur, offsetX: 4, offsetY: 4 }));
    } else if (!neonOn) {
      (txt as any).set('shadow', null);
    }
    c.renderAll();
  };

  const handleStroke = (on: boolean, color?: string, width?: number) => {
    const newOn = on, newColor = color ?? strokeColor, newWidth = width ?? strokeWidth;
    setStrokeOn(newOn);
    if (color !== undefined) setStrokeColor(color);
    if (width !== undefined) setStrokeWidth(width);
    const txt = getSelText(), c = fabricRef.current;
    if (!txt || !c) return;
    if (newOn) {
      (txt as any).set({ stroke: newColor, strokeWidth: newWidth, paintFirst: 'stroke' });
    } else {
      (txt as any).set({ stroke: null, strokeWidth: 0 });
    }
    c.renderAll();
  };

  const handleNeon = (on: boolean, color?: string) => {
    const newOn = on, newColor = color ?? neonColor;
    setNeonOn(newOn);
    if (color !== undefined) setNeonColor(color);
    const txt = getSelText(), c = fabricRef.current, fm = fabricModuleRef.current;
    if (!txt || !c || !fm) return;
    if (newOn) {
      (txt as any).set('shadow', new fm.Shadow({ color: newColor, blur: 25, offsetX: 0, offsetY: 0 }));
    } else if (!shadowOn) {
      (txt as any).set('shadow', null);
    } else {
      (txt as any).set('shadow', new fm.Shadow({ color: shadowColor, blur: shadowBlur, offsetX: 4, offsetY: 4 }));
    }
    c.renderAll();
  };

  const handleGrad = (on: boolean, c1?: string, c2?: string) => {
    const newOn = on, newC1 = c1 ?? gradColor1, newC2 = c2 ?? gradColor2;
    setGradOn(newOn);
    if (c1 !== undefined) setGradColor1(c1);
    if (c2 !== undefined) setGradColor2(c2);
    const txt = getSelText(), c = fabricRef.current, fm = fabricModuleRef.current;
    if (!txt || !c || !fm) return;
    if (newOn) {
      const grad = new fm.Gradient({
        type: 'linear',
        coords: { x1: 0, y1: 0, x2: 0, y2: (txt as any).height ?? 100 },
        colorStops: [{ offset: 0, color: newC1 }, { offset: 1, color: newC2 }],
      });
      (txt as any).set('fill', grad);
    } else {
      (txt as any).set('fill', textColor);
    }
    c.renderAll();
  };

  const handleTextColor = (color: string) => {
    setTextColor(color);
    const txt = getSelText(), c = fabricRef.current;
    if (!txt || !c) return;
    if (!gradOn) { (txt as any).set('fill', color); c.renderAll(); }
  };

  // ===== Background =====

  const changeBgColor = (color: string) => {
    const c = fabricRef.current;
    if (!c) return;
    c.backgroundColor = color;
    c.renderAll(); saveState();
  };

  // ===== Drawing mode =====

  const toggleDrawing = () => {
    const c = fabricRef.current;
    if (!c) return;
    const next = !drawingMode;
    setDrawingMode(next);
    (c as any).isDrawingMode = next;

    if (next) {
      if (!c.freeDrawingBrush) {
        const fm = fabricModuleRef.current;
        if (fm && (fm as any).PencilBrush) {
          c.freeDrawingBrush = new (fm as any).PencilBrush(c);
        }
      }
      if (c.freeDrawingBrush) {
        c.freeDrawingBrush.color = brushColor;
        c.freeDrawingBrush.width = brushWidth;
      }
    } else {
      c.getObjects().filter((p: any) => p.type === 'path' && !p.__isDrawing).forEach((p: any) => {
        p.__isDrawing = true;
        p.set({ selectable: false, evented: false });
        try { (c as any).sendObjectToBack(p); } catch { /* v5 fallback */ try { (c as any).sendToBack(p); } catch { /* */ } }
      });
      saveState();
    }
  };

  const handleBrushColor = (color: string) => {
    setBrushColor(color);
    const c = fabricRef.current;
    if (c && (c as any).isDrawingMode && c.freeDrawingBrush) c.freeDrawingBrush.color = color;
  };

  const handleBrushWidth = (w: number) => {
    setBrushWidth(w);
    const c = fabricRef.current;
    if (c && (c as any).isDrawingMode && c.freeDrawingBrush) c.freeDrawingBrush.width = w;
  };

  const clearDrawing = () => {
    const c = fabricRef.current;
    if (!c) return;
    c.getObjects().filter((p: any) => p.type === 'path').forEach(p => c.remove(p));
    c.renderAll(); saveState();
  };

  // ===== Element handlers =====

  const centerSelected = () => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    const o = obj as any;
    o.set({ left: CANVAS_W / 2 - (o.width * o.scaleX) / 2, top: CANVAS_H / 2 - (o.height * o.scaleY) / 2 });
    o.setCoords();
    c.renderAll(); saveState();
  };

  const bringAllInView = () => {
    const c = fabricRef.current;
    if (!c) return;
    c.getObjects().forEach((obj: any) => {
      if (obj.__isYT) return;
      const ow = obj.width * obj.scaleX, oh = obj.height * obj.scaleY;
      if (obj.left < -ow * 0.5) obj.set('left', 20);
      if (obj.top < -oh * 0.5) obj.set('top', 20);
      if (obj.left > CANVAS_W - ow * 0.5) obj.set('left', CANVAS_W - ow - 20);
      if (obj.top > CANVAS_H - oh * 0.5) obj.set('top', CANVAS_H - oh - 20);
      obj.setCoords();
    });
    c.renderAll(); saveState();
  };

  const addThumbnail = () => {
    const fm = fabricModuleRef.current, c = fabricRef.current;
    if (!fm || !c) return;
    const colors = ['#ff6b9d', '#6ba6ff', '#8bc34a', '#ffb74d', '#ba68c8', '#4db6ac'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const count = c.getObjects().filter((o: any) => o.type === 'group').length + 1;
    const rect = new fm.Rect({ width: 320, height: 180, fill: color, originX: 'left', originY: 'top' });
    const label = new fm.FabricText(`動画${count}`, {
      fontSize: 24, fontFamily: 'Noto Sans JP', fill: 'white', fontWeight: '700',
      originX: 'center', originY: 'center', left: 160, top: 90,
    });
    const g = new fm.Group([rect, label], { left: 100 + Math.random() * 200, top: 100 + Math.random() * 300 });
    c.add(g); c.renderAll();
  };

  const deleteSelected = () => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    const o = obj as any;
    if (o.__isTitle || o.__isYT) return;
    c.remove(obj); c.discardActiveObject(); c.renderAll();
  };

  // ===== Undo / Redo =====

  const undo = async () => {
    if (historyPointerRef.current <= 0) return;
    const c = fabricRef.current;
    if (!c) return;
    isUndoRedoingRef.current = true;
    historyPointerRef.current--;
    try {
      await (c as any).loadFromJSON(JSON.parse(historyRef.current[historyPointerRef.current]));
      c.renderAll();
    } catch { /* */ }
    isUndoRedoingRef.current = false;
    setCanUndo(historyPointerRef.current > 0);
    setCanRedo(historyPointerRef.current < historyRef.current.length - 1);
    syncSelection(c);
  };

  const redo = async () => {
    if (historyPointerRef.current >= historyRef.current.length - 1) return;
    const c = fabricRef.current;
    if (!c) return;
    isUndoRedoingRef.current = true;
    historyPointerRef.current++;
    try {
      await (c as any).loadFromJSON(JSON.parse(historyRef.current[historyPointerRef.current]));
      c.renderAll();
    } catch { /* */ }
    isUndoRedoingRef.current = false;
    setCanUndo(historyPointerRef.current > 0);
    setCanRedo(historyPointerRef.current < historyRef.current.length - 1);
    syncSelection(c);
  };

  // ===== Export =====

  const exportCanvas = (): string | null => {
    const c = fabricRef.current;
    if (!c) return null;
    clearGuides();
    c.setDimensions({ width: CANVAS_W, height: CANVAS_H }, { cssOnly: false } as never);
    c.setZoom(1);
    c.discardActiveObject();
    c.renderAll();
    const url = c.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
    resizeCanvas(c);
    return url;
  };

  const handleDone = () => { const url = exportCanvas(); if (url) onDone(url); };

  const downloadPng = () => {
    const url = exportCanvas();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = `ogp-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ===== Full reset =====

  const fullReset = () => {
    const c = fabricRef.current, fm = fabricModuleRef.current;
    if (!c || !fm) return;
    if (drawingMode) { setDrawingMode(false); (c as any).isDrawingMode = false; }
    c.clear(); c.backgroundColor = '#e1e3e4';
    addInitialObjects(c, fm);
    c.renderAll(); resizeCanvas(c);
    historyRef.current = []; historyPointerRef.current = -1;
    setShadowOn(false); setStrokeOn(false); setNeonOn(false); setGradOn(false);
    setTextColor('#000000');
    setSliderValues({ rotate: 0, skewX: 0, skewY: 0, scaleX: 0, scaleY: 0 });
    syncSelection(c);
    setTimeout(() => saveState(), 100);
  };

  // ===== Candidates =====

  const candidates = queue.flatMap(item => {
    const r: { title: string; sub: string }[] = [{ title: item.videoTitle, sub: '動画タイトル' }];
    if (!item.isFullVideo) r.push({ title: item.chapterLabel, sub: `チャプター: ${item.videoTitle}` });
    return r;
  }).filter((c, i, a) => a.findIndex(x => x.title === c.title) === i);

  const selectCandidate = (text: string) => {
    const txt = getSelText(), c = fabricRef.current;
    if (txt && c) { (txt as any).set('text', text); c.renderAll(); setTextInput(text); }
    else addText(text);
    setShowCandidates(false);
  };

  // ===== Render =====

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-surface-bright">
      <style>{SLIDER_CSS}</style>

      {/* Font prefetch divs (Android Chrome) */}
      <div style={{ position: 'absolute', left: -9999, top: -9999, visibility: 'hidden', pointerEvents: 'none' }}>
        {FONTS.map(f => (
          <div key={f.family} style={{ fontFamily: `'${f.family}', sans-serif`, fontWeight: f.weight, fontSize: 40 }}>
            ゴシック体あ亜A
          </div>
        ))}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-surface-bright gap-3">
          <p className="text-sm text-outline">フォント読み込み中…</p>
          <p className="text-xs text-outline/60">{fontProgress}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 shrink-0">
        <p className="text-sm font-bold uppercase tracking-widest">OGP EDITOR</p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-outline border border-outline-variant hover:border-primary hover:text-primary transition-colors cursor-pointer">
            Cancel
          </button>
          <button onClick={handleDone}
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer">
            Done
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 gap-0">
        {/* Canvas */}
        <div className="shrink-0 md:flex-1 p-2 md:p-4 flex items-start justify-center overflow-auto" style={{ minHeight: '45vh' }}>
          <div ref={wrapRef} className="w-full max-w-[720px] bg-white relative overflow-hidden" style={{ aspectRatio: '1200/630' }}>
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Panel */}
        <div className="flex flex-col flex-1 md:flex-none md:w-96 min-h-0 bg-surface-container-low border-t md:border-t-0 md:border-l border-outline-variant/20 overflow-hidden">
          {/* Selection info */}
          <div className={`px-3 py-2 text-[0.6875rem] shrink-0 ${selectedActive ? 'bg-primary text-on-primary-fixed' : 'bg-surface-container text-outline'}`}>
            {selectedInfo}
          </div>

          {/* Drawing mode indicator */}
          {drawingMode && (
            <div className="px-3 py-2 bg-[#ff6b9d] text-white text-[0.6875rem] text-center shrink-0">
              落書きモード中
            </div>
          )}

          {/* Tabs */}
          <div className="flex shrink-0 bg-surface-container-highest">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2.5 text-center text-[0.6875rem] font-bold tracking-widest cursor-pointer border-0 ${
                  activeTab === tab.id ? 'bg-primary text-on-primary-fixed' : 'bg-transparent text-outline hover:text-on-surface'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">

            {/* ===== TEXT TAB ===== */}
            {activeTab === 'text' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">テキスト編集</p>
                  <textarea value={textInput} onChange={e => handleTextChange(e.target.value)} disabled={textDisabled}
                    placeholder="テキストを選択してから編集、または下の「+ 追加」で新規作成"
                    className="w-full bg-white border-0 border-b border-outline-variant/40 px-2 py-2 text-sm focus:outline-none focus:border-b-2 focus:border-primary resize-y min-h-[50px] disabled:bg-surface-container-highest disabled:text-outline" />
                  <div className="flex gap-2 mt-1.5">
                    <button onClick={() => addText()}
                      className="flex-1 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer">
                      + テキスト追加
                    </button>
                    <button onClick={() => setShowCandidates(true)}
                      className="flex-1 py-1.5 text-xs font-bold uppercase tracking-widest text-on-surface border-b border-outline-variant hover:text-primary cursor-pointer bg-transparent">
                      候補から
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">フォント</p>
                  <div className="flex flex-wrap gap-1">
                    {FONTS.map(f => (
                      <button key={f.family} onClick={() => changeFont(f.family)}
                        className={`px-2.5 py-1.5 text-xs cursor-pointer border-0 ${
                          selectedFont === f.family ? 'bg-primary text-on-primary-fixed' : 'bg-surface-container-highest text-on-surface'
                        }`}
                        style={{ fontFamily: `'${f.family}', sans-serif`, fontWeight: f.weight }}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">変形（スライダーで調整、中央が0）</p>
                  {SLIDERS.map(s => (
                    <div key={s.id} className="ogp-slider py-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium">{s.label}</span>
                        <span>
                          <span className="text-[0.6875rem] text-outline tabular-nums mr-1">{s.display(sliderValues[s.id] ?? 0)}</span>
                          <button onClick={() => resetSlider(s.id)}
                            className="text-[0.625rem] text-outline underline cursor-pointer bg-transparent border-0 p-0">
                            リセット
                          </button>
                        </span>
                      </div>
                      <div className="relative py-1">
                        <div className="absolute left-1/2 top-1 bottom-1 w-0.5 bg-[#c6c6c6] pointer-events-none" />
                        <input type="range" min={s.min} max={s.max} step={s.step}
                          value={sliderValues[s.id] ?? 0} disabled={textDisabled}
                          onChange={e => handleSlider(s.id, Number(e.target.value))}
                          onMouseUp={() => saveState()} onTouchEnd={() => saveState()} />
                      </div>
                    </div>
                  ))}
                  <button onClick={resetAllTransforms}
                    className="mt-1 px-2.5 py-1.5 text-[0.6875rem] bg-surface-container-highest text-on-surface cursor-pointer border-0">
                    全ての変形をリセット
                  </button>
                </div>
              </div>
            )}

            {/* ===== STYLE TAB ===== */}
            {activeTab === 'style' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">文字エフェクト</p>
                  <div className="flex flex-col gap-2">
                    {/* Shadow */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 text-[0.6875rem] cursor-pointer">
                        <input type="checkbox" checked={shadowOn} onChange={e => handleShadow(e.target.checked)} /> 影
                      </label>
                      <input type="color" value={shadowColor} onChange={e => handleShadow(shadowOn, e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                      <input type="range" min="0" max="40" value={shadowBlur}
                        onChange={e => handleShadow(shadowOn, undefined, Number(e.target.value))} className="flex-1" />
                    </div>

                    {/* Stroke */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 text-[0.6875rem] cursor-pointer">
                        <input type="checkbox" checked={strokeOn} onChange={e => handleStroke(e.target.checked)} /> 縁取り
                      </label>
                      <input type="color" value={strokeColor} onChange={e => handleStroke(strokeOn, e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                      <input type="range" min="0" max="20" value={strokeWidth}
                        onChange={e => handleStroke(strokeOn, undefined, Number(e.target.value))} className="flex-1" />
                    </div>

                    {/* Neon */}
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-[0.6875rem] cursor-pointer">
                        <input type="checkbox" checked={neonOn} onChange={e => handleNeon(e.target.checked)} /> ネオン発光
                      </label>
                      <input type="color" value={neonColor} onChange={e => handleNeon(neonOn, e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                    </div>

                    {/* Gradient */}
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-[0.6875rem] cursor-pointer">
                        <input type="checkbox" checked={gradOn} onChange={e => handleGrad(e.target.checked)} /> グラデ塗り
                      </label>
                      <input type="color" value={gradColor1} onChange={e => handleGrad(gradOn, e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                      <input type="color" value={gradColor2} onChange={e => handleGrad(gradOn, undefined, e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                    </div>

                    {/* Text color */}
                    <div className="flex items-center gap-2">
                      <span className="text-[0.6875rem]">文字色</span>
                      <input type="color" value={textColor} onChange={e => handleTextColor(e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ===== BG TAB ===== */}
            {activeTab === 'bg' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">背景色</p>
                  <div className="flex flex-wrap gap-1">
                    {BG_COLORS.map(c => (
                      <button key={c.value} onClick={() => changeBgColor(c.value)}
                        className="px-2.5 py-1.5 text-xs cursor-pointer border-0"
                        style={{
                          backgroundColor: c.value,
                          color: c.value === '#000000' ? '#fff' : c.value === '#ffffff' ? '#000' : ['#ff6b9d','#6ba6ff','#8bc34a'].includes(c.value) ? '#fff' : '#000',
                          border: c.value === '#ffffff' ? '1px solid #c6c6c6' : 'none',
                        }}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">背景落書き</p>
                  <button onClick={toggleDrawing}
                    className={`w-full py-2.5 text-xs font-bold cursor-pointer border-0 ${
                      drawingMode ? 'bg-[#ff6b9d] text-white' : 'bg-primary text-on-primary-fixed'
                    }`}>
                    {drawingMode ? '落書きモード OFF（タップで終了）' : '落書きモード ON'}
                  </button>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[0.6875rem]">色</span>
                    <input type="color" value={brushColor} onChange={e => handleBrushColor(e.target.value)}
                      className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent" />
                    <span className="text-[0.6875rem]">太さ</span>
                    <input type="range" min="1" max="30" value={brushWidth}
                      onChange={e => handleBrushWidth(Number(e.target.value))} className="flex-1" />
                  </div>
                  <button onClick={clearDrawing}
                    className="w-full mt-1.5 py-1.5 text-xs text-on-surface border-b border-outline-variant cursor-pointer bg-transparent border-0 border-b">
                    落書き全消去
                  </button>
                  <p className="text-[0.625rem] text-outline/50 mt-1">落書きは背景レイヤー（サムネ・文字の後ろ）</p>
                </div>
              </div>
            )}

            {/* ===== ELEMENT TAB ===== */}
            {activeTab === 'element' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">配置</p>
                  <div className="flex gap-2">
                    <button onClick={centerSelected}
                      className="flex-1 py-1.5 text-xs text-on-surface border-b border-outline-variant cursor-pointer bg-transparent border-0 border-b">
                      選択を中央へ
                    </button>
                    <button onClick={bringAllInView}
                      className="flex-1 py-1.5 text-xs text-on-surface border-b border-outline-variant cursor-pointer bg-transparent border-0 border-b">
                      全部画面内へ
                    </button>
                  </div>
                  <p className="text-[0.625rem] text-outline/50 mt-1">画面外に飛んでしまった時に使えます</p>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">サムネ</p>
                  <button onClick={addThumbnail}
                    className="py-1.5 text-xs text-on-surface border-b border-outline-variant cursor-pointer bg-transparent border-0 border-b">
                    + サムネ追加
                  </button>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">選択要素</p>
                  <button onClick={deleteSelected}
                    className="w-full py-2 text-xs font-bold uppercase tracking-widest bg-error text-white hover:opacity-80 transition-colors cursor-pointer border-0">
                    選択を削除
                  </button>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">履歴</p>
                  <div className="flex gap-2">
                    <button onClick={undo} disabled={!canUndo}
                      className="flex-1 py-1.5 text-xs text-center text-on-surface border-b border-outline-variant cursor-pointer bg-transparent border-0 border-b disabled:opacity-40 disabled:cursor-not-allowed">
                      ↶ 元に戻す
                    </button>
                    <button onClick={redo} disabled={!canRedo}
                      className="flex-1 py-1.5 text-xs text-center text-on-surface border-b border-outline-variant cursor-pointer bg-transparent border-0 border-b disabled:opacity-40 disabled:cursor-not-allowed">
                      ↷ やり直す
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ===== OUTPUT TAB ===== */}
            {activeTab === 'output' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">書き出し</p>
                  <button onClick={handleDone}
                    className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer border-0">
                    Done — 共有画面へ
                  </button>
                  <p className="text-[0.55rem] text-outline/50 mt-1">
                    キャンバスの内容を画像として書き出し、共有ステップに進みます
                  </p>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">PNG Download</p>
                  <button onClick={downloadPng}
                    className="w-full py-2.5 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer bg-transparent">
                    PNG 保存
                  </button>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">全体</p>
                  <button onClick={fullReset}
                    className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-error text-white hover:opacity-80 transition-colors cursor-pointer border-0">
                    全リセット
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Candidates modal */}
      {showCandidates && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setShowCandidates(false); }}>
          <div className="bg-white w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto p-5">
            <p className="text-sm font-bold mb-3">候補から選ぶ</p>
            <p className="text-[0.55rem] text-outline mb-3">
              プレイリスト内の動画・チャプター名をテキストとして挿入できます
            </p>
            {candidates.map((c, i) => (
              <button key={i} onClick={() => selectCandidate(c.title)}
                className="block w-full text-left px-3 py-2.5 mb-1 bg-white text-sm cursor-pointer border-0 hover:bg-surface-container-highest active:bg-surface-container-highest">
                {c.title}
                <span className="block text-[0.55rem] text-outline mt-0.5">{c.sub}</span>
              </button>
            ))}
            <button onClick={() => setShowCandidates(false)}
              className="w-full mt-3 py-2 text-xs font-bold uppercase tracking-widest text-outline border-0 border-b border-outline-variant hover:text-primary cursor-pointer bg-transparent">
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
