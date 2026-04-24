import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ChapterQueueItem } from '../types/playlist';

// fabric.js の型（動的インポート用）
type FabricModule = typeof import('fabric');
type FabricCanvas = InstanceType<FabricModule['Canvas']>;

const CANVAS_W = 1200;
const CANVAS_H = 630;

const FONTS = [
  { label: 'ゴシック', family: 'Noto Sans JP', weight: 700 },
  { label: '明朝', family: 'Noto Serif JP', weight: 700 },
  { label: '丸ゴ', family: 'M PLUS Rounded 1c', weight: 700 },
] as const;

const BG_COLORS = [
  { label: 'グレー', value: '#e1e3e4' },
  { label: '黒', value: '#000000' },
  { label: '白', value: '#ffffff' },
  { label: 'ブルー', value: '#6ba6ff' },
  { label: 'ピンク', value: '#ff6b9d' },
  { label: 'グリーン', value: '#8bc34a' },
  { label: 'オレンジ', value: '#ffb74d' },
] as const;

interface OgpEditorProps {
  /** プレイリストタイトル（初期テキストに使用） */
  title: string;
  /** キュー内の動画（候補テキスト・サムネ用） */
  queue: ChapterQueueItem[];
  /** 完了時コールバック（data URL を渡す） */
  onDone: (dataUrl: string) => void;
  /** キャンセル時コールバック */
  onCancel: () => void;
}

export function OgpEditor({ title, queue, onDone, onCancel }: OgpEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const fabricModuleRef = useRef<FabricModule | null>(null);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'text' | 'bg' | 'output'>('text');
  const [textInput, setTextInput] = useState(title);
  const [textDisabled, setTextDisabled] = useState(true);
  const [selectedFont, setSelectedFont] = useState('Noto Sans JP');
  const [selectedInfo, setSelectedInfo] = useState('未選択');
  const [selectedActive, setSelectedActive] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  // 影・縁取りの状態
  const [shadowOn, setShadowOn] = useState(false);
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [textColor, setTextColor] = useState('#000000');

  // テキストID用カウンター
  const textIdCounterRef = useRef(1);

  // --------- fabric.js 動的ロードと初期化 ---------
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Google Fonts のプリロード
      const fontLinks = [
        'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap',
        'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700;900&display=swap',
        'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700;900&display=swap',
      ];
      fontLinks.forEach(href => {
        if (!document.querySelector(`link[href="${href}"]`)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          document.head.appendChild(link);
        }
      });

      // document.fonts.ready を待ってフォントを確実に読み込む
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      // fabric.js を動的インポート
      const fabricModule = await import('fabric');
      if (cancelled) return;
      fabricModuleRef.current = fabricModule;

      const canvasEl = canvasRef.current;
      if (!canvasEl) return;

      const canvas = new fabricModule.Canvas(canvasEl, {
        backgroundColor: '#e1e3e4',
        preserveObjectStacking: true,
        width: CANVAS_W,
        height: CANVAS_H,
      });
      fabricRef.current = canvas;

      // 初期テキスト配置
      const titleText = new fabricModule.Textbox(title || 'プレイリストタイトル', {
        left: 60,
        top: 80,
        width: 1000,
        fontSize: 80,
        fontFamily: 'Noto Sans JP',
        fontWeight: '700',
        fill: '#000000',
        editable: false,
        splitByGrapheme: false,
      });
      (titleText as unknown as Record<string, unknown>).__isTitle = true;
      (titleText as unknown as Record<string, unknown>).__textId = 'title_main';
      canvas.add(titleText);

      // キューの先頭4件のサムネプレースホルダー配置
      const thumbPositions = [
        { x: 60, y: 320 },
        { x: 400, y: 320 },
        { x: 60, y: 500 },
        { x: 400, y: 500 },
      ];
      const thumbItems = queue.slice(0, 4);
      thumbItems.forEach((item, i) => {
        const pos = thumbPositions[i];
        const rect = new fabricModule.Rect({
          width: 320,
          height: 180,
          fill: '#585f6c',
          originX: 'left',
          originY: 'top',
        });
        const label = new fabricModule.FabricText(item.chapterLabel.slice(0, 20), {
          fontSize: 20,
          fontFamily: 'Noto Sans JP',
          fill: 'white',
          fontWeight: '700',
          originX: 'center',
          originY: 'center',
          left: 160,
          top: 90,
        });
        const group = new fabricModule.Group([rect, label], {
          left: pos.x,
          top: pos.y,
        });
        canvas.add(group);
      });

      // YouTube 出典表記（固定）
      const ytLabel = new fabricModule.FabricText('▶ YouTube', {
        left: 1040,
        top: 590,
        fontSize: 18,
        fontFamily: 'Noto Sans JP',
        fontWeight: '700',
        fill: '#000000',
        selectable: false,
        evented: false,
      });
      (ytLabel as unknown as Record<string, unknown>).__isYT = true;
      canvas.add(ytLabel);

      canvas.renderAll();
      resizeCanvasToFit(canvas);

      // イベントリスナ
      canvas.on('selection:created', () => syncWithSelected(canvas));
      canvas.on('selection:updated', () => syncWithSelected(canvas));
      canvas.on('selection:cleared', () => syncWithSelected(canvas));

      setLoading(false);
    }

    init();

    return () => {
      cancelled = true;
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------- リサイズ ---------
  const resizeCanvasToFit = useCallback((canvas: FabricCanvas) => {
    const wrap = wrapRef.current;
    if (!wrap || !canvas) return;
    const w = wrap.clientWidth;
    const h = w * (CANVAS_H / CANVAS_W);
    wrap.style.height = `${h}px`;
    const scale = w / CANVAS_W;
    canvas.setDimensions({ width: w, height: h }, { cssOnly: false } as never);
    canvas.setZoom(scale);
    canvas.renderAll();
  }, []);

  useEffect(() => {
    const handler = () => {
      if (fabricRef.current) resizeCanvasToFit(fabricRef.current);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [resizeCanvasToFit]);

  // --------- テキスト選択同期 ---------
  function isTextObject(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') && !o.__isYT;
  }

  function getSelectedText(): Record<string, unknown> | null {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const obj = canvas.getActiveObject();
    if (isTextObject(obj)) return obj as unknown as Record<string, unknown>;
    return null;
  }

  function syncWithSelected(canvas: FabricCanvas) {
    const obj = canvas.getActiveObject();
    if (isTextObject(obj)) {
      const o = obj as unknown as Record<string, unknown>;
      setTextInput(o.text as string);
      setTextDisabled(false);
      setSelectedFont(o.fontFamily as string);
      if (o.__isTitle) {
        setSelectedInfo('選択中：タイトル');
      } else {
        setSelectedInfo('選択中：テキスト');
      }
      setSelectedActive(true);
    } else if (obj) {
      setTextInput('');
      setTextDisabled(true);
      setSelectedInfo('選択中：サムネ');
      setSelectedActive(true);
    } else {
      setTextInput('');
      setTextDisabled(true);
      setSelectedInfo('未選択（要素をタップ / + テキスト追加で新規）');
      setSelectedActive(false);
    }
  }

  // --------- テキスト編集 ---------
  const handleTextChange = (value: string) => {
    setTextInput(value);
    const txt = getSelectedText();
    const canvas = fabricRef.current;
    if (txt && canvas) {
      (txt as Record<string, unknown>).text = value;
      // v7: set + renderAll
      const obj = txt as unknown as { set: (key: string, val: unknown) => void };
      obj.set('text', value);
      canvas.renderAll();
    }
  };

  const addText = (initialText = '新しいテキスト') => {
    const fabric = fabricModuleRef.current;
    const canvas = fabricRef.current;
    if (!fabric || !canvas) return;

    const t = new fabric.Textbox(initialText, {
      left: 200 + Math.random() * 200,
      top: 200 + Math.random() * 200,
      width: 400,
      fontSize: 60,
      fontFamily: 'Noto Sans JP',
      fontWeight: '700',
      fill: '#000000',
      editable: false,
      splitByGrapheme: false,
    });
    (t as unknown as Record<string, unknown>).__textId = 'text_' + textIdCounterRef.current++;
    canvas.add(t);
    canvas.setActiveObject(t);
    canvas.renderAll();
    syncWithSelected(canvas);
  };

  // --------- フォント変更 ---------
  const changeFont = (family: string) => {
    const txt = getSelectedText();
    const canvas = fabricRef.current;
    if (!txt || !canvas) return;
    const obj = txt as unknown as {
      set: (key: string, val: unknown) => void;
      initDimensions?: () => void;
      setCoords: () => void;
    };
    obj.set('fontFamily', family);
    obj.set('dirty', true);
    if (typeof obj.initDimensions === 'function') obj.initDimensions();
    obj.setCoords();
    setSelectedFont(family);
    canvas.requestRenderAll();
    setTimeout(() => canvas.renderAll(), 0);
  };

  // --------- 背景色変更 ---------
  const changeBgColor = (color: string) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.backgroundColor = color;
    canvas.renderAll();
  };

  // --------- エフェクト ---------
  const updateShadow = (on: boolean) => {
    setShadowOn(on);
    const txt = getSelectedText();
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!txt || !canvas || !fabric) return;
    const obj = txt as unknown as { set: (key: string, val: unknown) => void };
    if (on) {
      obj.set('shadow', new fabric.Shadow({ color: '#000000', blur: 10, offsetX: 4, offsetY: 4 }));
    } else {
      obj.set('shadow', null);
    }
    canvas.renderAll();
  };

  const updateStroke = (on: boolean, color?: string, width?: number) => {
    setStrokeOn(on);
    if (color !== undefined) setStrokeColor(color);
    if (width !== undefined) setStrokeWidth(width);
    const txt = getSelectedText();
    const canvas = fabricRef.current;
    if (!txt || !canvas) return;
    const obj = txt as unknown as { set: (props: Record<string, unknown>) => void };
    if (on) {
      obj.set({
        stroke: color ?? strokeColor,
        strokeWidth: width ?? strokeWidth,
        paintFirst: 'stroke',
      });
    } else {
      obj.set({ stroke: null, strokeWidth: 0 });
    }
    canvas.renderAll();
  };

  const changeTextColor = (color: string) => {
    setTextColor(color);
    const txt = getSelectedText();
    const canvas = fabricRef.current;
    if (!txt || !canvas) return;
    const obj = txt as unknown as { set: (key: string, val: unknown) => void };
    obj.set('fill', color);
    canvas.renderAll();
  };

  // --------- 削除 ---------
  const deleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const o = obj as unknown as Record<string, unknown>;
    if (o.__isTitle || o.__isYT) return; // 初期要素は削除不可
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  // --------- 候補から選択 ---------
  const candidateItems = queue.flatMap(item => {
    const results: { title: string; sub: string }[] = [];
    results.push({ title: item.videoTitle, sub: '動画タイトル' });
    if (!item.isFullVideo) {
      results.push({ title: item.chapterLabel, sub: `チャプター: ${item.videoTitle}` });
    }
    return results;
  });
  // 重複を除去
  const uniqueCandidates = candidateItems.filter(
    (item, index, self) => self.findIndex(c => c.title === item.title) === index
  );

  const selectCandidate = (text: string) => {
    const txt = getSelectedText();
    const canvas = fabricRef.current;
    if (txt && canvas) {
      const obj = txt as unknown as { set: (key: string, val: unknown) => void };
      obj.set('text', text);
      canvas.renderAll();
      setTextInput(text);
    } else {
      addText(text);
    }
    setShowCandidates(false);
  };

  // --------- PNG書き出し ---------
  const exportCanvas = (): string | null => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    // フル解像度で書き出し
    canvas.setDimensions({ width: CANVAS_W, height: CANVAS_H }, { cssOnly: false } as never);
    canvas.setZoom(1);
    canvas.discardActiveObject();
    canvas.renderAll();
    const dataUrl = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
    // リサイズを戻す
    resizeCanvasToFit(canvas);
    return dataUrl;
  };

  const handleDone = () => {
    const dataUrl = exportCanvas();
    if (dataUrl) {
      onDone(dataUrl);
    }
  };

  // --------- タブ定義 ---------
  const tabs = [
    { id: 'text' as const, label: '文字' },
    { id: 'bg' as const, label: '背景' },
    { id: 'output' as const, label: '書出' },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-surface-bright">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 shrink-0">
        <p className="text-sm font-bold uppercase tracking-widest">OGP EDITOR</p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-outline border border-outline-variant hover:border-primary hover:text-primary transition-colors cursor-pointer"
          >
            キャンセル
          </button>
          <button
            onClick={handleDone}
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer"
          >
            完了
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 gap-0">
        {/* キャンバスエリア */}
        <div className="shrink-0 md:flex-1 p-2 md:p-4 flex items-start justify-center overflow-auto" style={{ minHeight: '45vh' }}>
          <div ref={wrapRef} className="w-full max-w-[720px] bg-white relative overflow-hidden" style={{ aspectRatio: '1200/630' }}>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-bright z-10">
                <p className="text-xs text-outline uppercase tracking-widest">読み込み中...</p>
              </div>
            )}
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* パネルエリア */}
        <div className="flex flex-col flex-1 md:flex-none md:w-96 min-h-0 bg-surface-container-low border-t md:border-t-0 md:border-l border-outline-variant/20 overflow-hidden">
          {/* 選択状態 */}
          <div className={`px-3 py-2 text-[0.6875rem] shrink-0 ${selectedActive ? 'bg-primary text-on-primary-fixed' : 'bg-surface-container text-outline'}`}>
            {selectedInfo}
          </div>

          {/* タブ */}
          <div className="flex shrink-0 bg-surface-container-highest">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2.5 text-center text-[0.6875rem] font-bold tracking-widest cursor-pointer border-0 ${
                  activeTab === tab.id
                    ? 'bg-primary text-on-primary-fixed'
                    : 'bg-transparent text-outline hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* タブコンテンツ */}
          <div className="flex-1 overflow-y-auto p-3">
            {/* 文字タブ */}
            {activeTab === 'text' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    テキスト編集
                  </p>
                  <textarea
                    value={textInput}
                    onChange={e => handleTextChange(e.target.value)}
                    disabled={textDisabled}
                    placeholder="テキストを選択してから編集、または下の「+ 追加」で新規作成"
                    className="w-full bg-white border-0 border-b border-outline-variant/40 px-2 py-2 text-sm focus:outline-none focus:border-b-2 focus:border-primary resize-y min-h-[50px] disabled:bg-surface-container-highest disabled:text-outline"
                  />
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={() => addText()}
                      className="flex-1 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer"
                    >
                      + テキスト追加
                    </button>
                    <button
                      onClick={() => setShowCandidates(true)}
                      className="flex-1 py-1.5 text-xs font-bold uppercase tracking-widest text-on-surface border-b border-outline-variant hover:text-primary cursor-pointer bg-transparent"
                    >
                      候補から
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    フォント
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {FONTS.map(f => (
                      <button
                        key={f.family}
                        onClick={() => changeFont(f.family)}
                        className={`px-2.5 py-1.5 text-xs cursor-pointer border-0 ${
                          selectedFont === f.family
                            ? 'bg-primary text-on-primary-fixed'
                            : 'bg-surface-container-highest text-on-surface'
                        }`}
                        style={{ fontFamily: `'${f.family}', sans-serif`, fontWeight: f.weight }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    装飾
                  </p>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-[0.6875rem] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shadowOn}
                        onChange={e => updateShadow(e.target.checked)}
                      />
                      影
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-[0.6875rem] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={strokeOn}
                          onChange={e => updateStroke(e.target.checked)}
                        />
                        縁取り
                      </label>
                      {strokeOn && (
                        <>
                          <input
                            type="color"
                            value={strokeColor}
                            onChange={e => updateStroke(true, e.target.value)}
                            className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent"
                          />
                          <input
                            type="range"
                            min="0"
                            max="20"
                            value={strokeWidth}
                            onChange={e => updateStroke(true, undefined, parseInt(e.target.value))}
                            className="flex-1"
                          />
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.6875rem]">文字色</span>
                      <input
                        type="color"
                        value={textColor}
                        onChange={e => changeTextColor(e.target.value)}
                        className="w-7 h-7 border-0 p-0 cursor-pointer bg-transparent"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    要素操作
                  </p>
                  <button
                    onClick={deleteSelected}
                    className="w-full py-2 text-xs font-bold uppercase tracking-widest bg-error text-white hover:opacity-80 transition-colors cursor-pointer"
                  >
                    選択を削除
                  </button>
                </div>
              </div>
            )}

            {/* 背景タブ */}
            {activeTab === 'bg' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    背景色
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {BG_COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => changeBgColor(c.value)}
                        className="px-2.5 py-1.5 text-xs cursor-pointer border-0"
                        style={{
                          backgroundColor: c.value,
                          color: c.value === '#000000' ? '#fff' : c.value === '#ffffff' ? '#000' : '#000',
                          border: c.value === '#ffffff' ? '1px solid #c6c6c6' : 'none',
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 書出タブ */}
            {activeTab === 'output' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    プレビュー書き出し
                  </p>
                  <button
                    onClick={handleDone}
                    className="w-full py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors cursor-pointer"
                  >
                    完了して共有画面へ
                  </button>
                  <p className="text-[0.55rem] text-outline/50 mt-1">
                    キャンバスの内容を画像として書き出し、共有ステップに進みます
                  </p>
                </div>

                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-1">
                    PNG ダウンロード
                  </p>
                  <button
                    onClick={() => {
                      const dataUrl = exportCanvas();
                      if (!dataUrl) return;
                      const a = document.createElement('a');
                      a.href = dataUrl;
                      a.download = `ogp-${Date.now()}.png`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="w-full py-2.5 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer"
                  >
                    PNG 保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 候補モーダル */}
      {showCandidates && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setShowCandidates(false); }}
        >
          <div className="bg-white w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto p-5">
            <p className="text-sm font-bold mb-3">候補から選ぶ</p>
            <p className="text-[0.55rem] text-outline mb-3">
              プレイリスト内の動画・チャプター名をテキストとして挿入できます
            </p>
            {uniqueCandidates.map((c, i) => (
              <button
                key={i}
                onClick={() => selectCandidate(c.title)}
                className="block w-full text-left px-3 py-2.5 mb-1 bg-white text-sm cursor-pointer border-0 hover:bg-surface-container-highest active:bg-surface-container-highest"
              >
                {c.title}
                <span className="block text-[0.55rem] text-outline mt-0.5">{c.sub}</span>
              </button>
            ))}
            <button
              onClick={() => setShowCandidates(false)}
              className="w-full mt-3 py-2 text-xs font-bold uppercase tracking-widest text-outline border-b border-outline-variant hover:text-primary cursor-pointer bg-transparent border-0 border-b"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
