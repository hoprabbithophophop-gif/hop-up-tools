// 灰toダイヤモンド「原石の版」— 部品どうしの約束（型だけ）。
//
// この版の主役は灰色の原石。曲の進みで必ず削れていき、大サビで透明なダイヤが完成する。
// 削れ具合は動画の時刻だけで決まる（人が少なくても必ず完成する）。
// タップで変わるのは「どの面が何色になるか」と「どれだけ明るく輝くか」だけ。
//
// ここには値も処理も置かない。部品（幾何・描画・粒・山・器）が同じ言葉で話すための型だけ。

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];

/** 面の種類。round brilliant（ラウンドブリリアントカット）の名前で呼ぶ。
 *  table=上の平らな面 / star=テーブルのまわりの三角 / bezel=クラウンの凧形 / upperGirdle=クラウン側の腰の三角
 *  girdle=腰の帯 / lowerGirdle=パビリオン側の腰の三角 / pavilion=底へ向かう長い面 / culet=底の尖り（小さな面か点） */
export type FaceKind = "table" | "star" | "bezel" | "upperGirdle" | "girdle" | "lowerGirdle" | "pavilion" | "culet";

/** ダイヤの1つの面。verts は頂点の番号（多角形・表から見て反時計回り） */
export interface StoneFace {
  verts: number[];
  kind: FaceKind;
  /** 削られる順番（0..1）。曲の削れ具合 cutFraction(t) がこの値を越えたところから、この面が削れ始める。
   *  値は幾何の部品が決める（見た目が自然な順・決定的で乱数に頼らない） */
  cutRank: number;
}

/** 原石とダイヤの形。頂点は同じ番号で対応する（rough=原石の位置、fine=ダイヤの位置）。
 *  座標は模型の単位で、ダイヤは半径およそ1の球に収まる。y は上が正（テーブルが +y、尖りが -y）。
 *  原石はダイヤを外側へ押し出した形なので、必ずダイヤを包む */
export interface StoneMesh {
  /** ダイヤの頂点 xyz を並べたもの（長さ = 頂点数 × 3） */
  fine: Float32Array;
  /** 原石の頂点 xyz。fine と同じ並び */
  rough: Float32Array;
  faces: StoneFace[];
  /** 原石の外接半径（模型の単位）。画面に収める大きさを決めるのに使う */
  roughRadius: number;
}

/** 面ごとの、いまの状態。器（StoneCanvas）が持ち、描画の部品が読む */
export interface FaceState {
  /** 削れ具合 0..1（0=原石のまま、1=ダイヤの面）。時刻の純関数から毎コマ入れ直す */
  cut: Float32Array;
  /** 染まった色。null は染まっていない（磨いた灰色のまま） */
  color: (RGB | null)[];
  /** 輝き 0..1。💎が当たった時に 1 になり、時間で減る */
  glow: Float32Array;
  /** 自分が押して染めた面か（1=自分）。小さな印を付ける */
  own: Uint8Array;
  /** 完成して透明になったか（大サビの放つ瞬間の後）。true の間は面の色は放たれた後なので、本体は透明に描く */
  clear: boolean;
}

/** 石の見え方。cx,cy は画面上の中心(px)、r は模型の単位1が何pxか。
 *  rotY は縦の軸まわりの回転（尖りは必ず下のまま）、rotX は手前へ少し倒す角（固定・上面が多く見えるように）。
 *  bulge は間奏の脈打ちなどで一時的に膨らませる倍率（普段は1） */
export interface StoneView {
  cx: number;
  cy: number;
  r: number;
  rotY: number;
  rotX: number;
  bulge: number;
}

/** 画面の四角（px） */
export interface Rect { x: number; y: number; w: number; h: number }

/** ページが器に渡す置き場所。画面の縦横で自動で切り替える（Hop指定）。
 *  portrait=縦長（動画を上に固定・その下に原石・さらに下に山）
 *  wide=横長のPC（動画が真ん中・大きな原石をその後ろに・山は画面下の端いっぱい）
 *  phoneLandscape=スマホ横（動画が左・原石と山が右） */
export type StoneLayoutMode = "portrait" | "wide" | "phoneLandscape";
export interface StoneLayout {
  mode: StoneLayoutMode;
  /** 原石を置く範囲。中心と大きさはこの四角から決める。wide では動画の裏に重なる（動画の上には描かない＝動画の矩形はクリップで除外） */
  stone: Rect;
  /** 山を置く範囲。てっぺんからすそまで必ずこの中に収める */
  pile: Rect;
}
