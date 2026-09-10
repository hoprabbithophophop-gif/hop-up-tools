/* =============================================================================
 * 本物の💎の描き方（屈折・全反射・分散まで実際に計算する）
 *
 * 見本 scratchpad/diamond-samples/renderer-webgl-standalone.js を本番へ持ってきたもの。
 * 外から借りる部品はゼロ。描画面の用意も計算式の組み上げも自前で行う。
 *
 * WebGL で「屈折・全反射・分散」を実際に計算した宝石を描き、
 * 回転角ごとに 2D canvas へ焼き写す。焼いた後は普通の絵なので、
 * 再生中の重さは今までと変わらない（貼るだけ）。
 *
 * 中でやっていること
 *   1. ブリリアントカットの形を「73枚の平面の内側」として定義する
 *   2. その平面を切り合わせて、面ごとに平らな多面体メッシュを作る
 *   3. 表面に当たった光を石の中へ屈折させ、同じ73枚の平面に対して
 *      出口を探し、角度が浅ければ全反射して中で跳ね返り続ける
 *   4. 外へ出るときに赤・緑・青で屈折率をずらし、色を虹に割る
 *
 * 見本との違いは次の3点だけで、形の組み立てと、屈折・全反射・分散の計算は
 * 1文字も変えていない。
 *   - TypeScript にして型を付けた
 *   - 焼く処理を「途中で中断して続きから再開できる」形に分けた（BakeJob）。
 *     1色ぶんを一気に焼くと、その間だけ画面が固まるため。
 *   - 石の身の明るさの倍率 BODY_GAIN を足した。これは後から見本
 *     scratchpad/diamond-samples/picker.html で決まった調整で、
 *     同じ計算になるように写している。詳しくは下の「明るさ」のつまみの節。
 *
 * 使う側は gemSprites.ts を見ること。ここは絵を作る道具だけを持つ。
 * ========================================================================== */

/* ===========================================================================
 * 調整しそうな数値
 * ======================================================================== */

// 石の傾き（度）。石の軸をカメラ側へ何度倒すか。
// 回転は画面の縦軸まわりなので、この角度が大きいほど
// 「テーブル面がこちらを向く角度」と「裏を向く角度」の差が激しくなる。
// 0 にすると軸と回転軸が一致して、外形が一切変わらなくなる。
const TILT_DEG = 26;

// 画面に対する光の向き（今までの💎と同じ -Math.PI/3 をそのまま使う）。
const LIGHT_ANGLE = -Math.PI / 3;
// 光源の手前寄せ具合。大きいほど正面から当てた感じになる。
const LIGHT_Z = 0.8;

// ダイヤの屈折率。赤・緑・青でずらすと色が虹に割れる（分散）。
// 差を広げると虹が派手になり、狭めると無色寄りになる。
const IOR_R = 2.407;
const IOR_G = 2.417;
const IOR_B = 2.435;

// 石の中で光が跳ね返る回数の上限。増やすほど奥行きが出るが焼き時間も伸びる。
const BOUNCES = 4;

// 焼くときの内部解像度の倍率。2 なら 96px の絵を 192px で描いて縮める。
// 縁のギザギザと閃光のちらつきが減る。3 にすると更に滑らかだが約2倍重い。
const SUPERSAMPLE = 2;

// 外形を canvas の何割に収めるか。
const FIT = 0.95;

// 石の身の色の濃さ。大きいほど濃い色になり、小さいほど淡くなる。
const ABSORB_K = 0.95;
// 濃い色が黒い塊にならないための下限。厚い所でもこの割合の光は通す。
const TRANSMIT_FLOOR = 0.16;

/* ---------------------------------------------------------------------------
 * 「明るさ」のつまみ
 *
 * 見本 scratchpad/diamond-samples/picker.html には 0〜10 の目盛りが付いた
 * つまみが3本ある。そのうち「明るさ」の1本だけを動かして 8 に決めた。
 * 残りの2本、「光る所の太さ」と「貼る大きさ」は 2 のまま、つまり今までと同じ。
 *
 * ここに入っているのは 目盛り8 の行。
 * 目盛り2 の行は、このつまみを入れる前の見え方とまったく同じ数値になっている。
 * 明るさを変えたくなったら、下の表から目盛りの行を選んで、
 * すぐ下の4つの定数に数字を写し替えるだけでよい。表そのものは書き換えない。
 *
 *   目盛り | BODY_GAIN | BODY_AMBIENT | HUE_LIFT | EXPOSURE
 *   -------+-----------+--------------+----------+----------
 *      0   |   0.781   |   0.0747     |  0.1089  |  1.330
 *      1   |   0.884   |   0.0864     |  0.1044  |  1.340
 *      2   |   1.000   |   0.1000     |  0.1000  |  1.350   ← 調整を入れる前と同じ
 *      3   |   1.132   |   0.1157     |  0.0958  |  1.360
 *      4   |   1.281   |   0.1339     |  0.0918  |  1.370
 *      5   |   1.450   |   0.1550     |  0.0880  |  1.380
 *      6   |   1.641   |   0.1755     |  0.0808  |  1.393
 *      7   |   1.856   |   0.1987     |  0.0741  |  1.407
 *      8   |   2.100   |   0.2250     |  0.0680  |  1.420   ← いま入っているのはこれ
 *      9   |   2.376   |   0.2548     |  0.0624  |  1.434
 *     10   |   2.688   |   0.2885     |  0.0573  |  1.447
 * ------------------------------------------------------------------------ */

// 石の身の明るさの倍率。石の中を通ってきた光にだけ掛ける。
// 上げるほど身の色が明るく前に出る。表面で跳ね返った白い光には掛からないので、
// きらめきの太さや強さはこの値では変わらない。
const BODY_GAIN = 2.100;
// 影の側を黒く潰さないための底上げ。
// 上げるほど暗い側が持ち上がり、下げるほど陰影がはっきりする。
// BODY_GAIN より先に足されるので、実際の効き目は BODY_GAIN 倍される。
const BODY_AMBIENT = 0.2250;
// 色味の底上げ。0 だと #005eb8 の赤成分のように、ある色が完全に死ぬ。
// 上げるほど淡く、下げるほど彩度が高くなる。
const HUE_LIFT = 0.0680;
// 露出。全体の明暗。上げるほど白飛び寄り、下げるほど締まる。
const EXPOSURE = 1.420;

// 環境の明るさ。全体の眩しさ。
const ENV_GAIN = 1.15;
// 環境の暗い側の下限。0 にすると暗い所が真っ黒になり、濃い色の石が黒い粒になる。
const ENV_FLOOR = 0.20;
// 白い帯を「写真の白飛び」相当まで持ち上げる強さ。閃光の眩しさに効く。
const HDR_BOOST = 26.0;

// 面が光をまっすぐ返した瞬間の閃光の鋭さ。大きいほど一瞬だけ強く光る。
const FLASH_TIGHT = 520.0;
// 閃光の強さ。
const FLASH_GAIN = 1.5;

// 石の不透明さ。1.0 で完全に不透明。下げると背景が透けてガラスらしくなるが、
// 背景色によっては沈むので既定は 1.0。
const MIN_ALPHA = 1.0;

// 環境画像の大きさ。2の冪にしておく。
const ENV_W = 1024;
const ENV_H = 512;

/* ===========================================================================
 * ブリリアントカットの寸法
 * ======================================================================== */

const R_TABLE = 0.53; // テーブル面の外接半径
const Y_TABLE = 0.36; // テーブル面の高さ
const R_STAR = 0.74; // スター面の頂点の半径
const R_GIRDLE = 1.0; // ガードル（一番太い胴回り）の半径
const Y_GIRDLE_TOP = 0.08;
const Y_GIRDLE_BOT = -0.04;
const Y_CULET = -0.84; // 下の尖り
const R_JUNCTION = 0.22; // ロワーガードル面の下端が集まる位置の半径

/* ===========================================================================
 * ベクトルの小道具
 * ======================================================================== */

type Vec3 = [number, number, number];
type Plane = { n: Vec3; d: number };
type Face = { n: Vec3; d: number; poly: Vec3[] };
type Solid = { planes: Plane[]; faces: Face[] };

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/* ===========================================================================
 * 1. 形を「平面の内側」として定義する
 *    すべての平面は dot(n, p) <= d の側が石の中。原点は必ず中にある。
 * ======================================================================== */

function planeFromPoints(p1: Vec3, p2: Vec3, p3: Vec3): Plane {
  let n = norm(cross(sub(p2, p1), sub(p3, p1)));
  let d = dot(n, p1);
  // 原点が内側（d > 0）になるように向きを揃える
  if (d < 0) {
    n = [-n[0], -n[1], -n[2]];
    d = -d;
  }
  return { n: n, d: d };
}

// 回転対称な面は「半径方向の傾き」だけで決まるので、そこから直接組む
function planeFromProfile(azimuth: number, nr: number, ny: number, d: number): Plane {
  return { n: [nr * Math.cos(azimuth), ny, nr * Math.sin(azimuth)], d: d };
}

function buildPlanes(): Plane[] {
  const planes: Plane[] = [];
  let k: number;
  let c: number;
  const TAU = Math.PI * 2;
  const A: number[] = []; // 主方向 8本
  const B: number[] = []; // 中間方向 8本
  for (k = 0; k < 8; k++) {
    A.push((k / 8) * TAU);
    B.push((k / 8) * TAU + TAU / 16);
  }

  // --- テーブル面（上の平らな八角形） ---
  planes.push({ n: [0, 1, 0], d: Y_TABLE });

  // --- カイト面 8枚 ---
  // 断面で見ると、テーブルの角(R_TABLE, Y_TABLE)からガードル(R_GIRDLE, Y_GIRDLE_TOP)へ
  // 下がる直線。その直線に垂直な向きが面の法線。
  const kdr = R_GIRDLE - R_TABLE;
  const kdy = Y_GIRDLE_TOP - Y_TABLE;
  const klen = Math.hypot(kdr, kdy);
  const kiteNr = -kdy / klen;
  const kiteNy = kdr / klen;
  const kiteD = kiteNr * R_GIRDLE + kiteNy * Y_GIRDLE_TOP;
  for (k = 0; k < 8; k++) {
    planes.push(planeFromProfile(A[k], kiteNr, kiteNy, kiteD));
  }

  // --- スター面の頂点 ---
  // 両隣のカイト面の上に乗る点なので、高さは寸法からではなく面から決まる。
  const cos225 = Math.cos(TAU / 16);
  const yStar = (kiteD - kiteNr * R_STAR * cos225) / kiteNy;
  const P: Vec3[] = []; // スター面の頂点 8個
  for (k = 0; k < 8; k++) {
    P.push([R_STAR * Math.cos(B[k]), yStar, R_STAR * Math.sin(B[k])]);
  }

  // --- テーブル面の角 8個 ---
  const T: Vec3[] = [];
  for (k = 0; k < 8; k++) {
    T.push([R_TABLE * Math.cos(A[k]), Y_TABLE, R_TABLE * Math.sin(A[k])]);
  }

  // --- スター面 8枚（テーブルの一辺 + スター頂点） ---
  for (k = 0; k < 8; k++) {
    planes.push(planeFromPoints(T[k], T[(k + 1) % 8], P[k]));
  }

  // --- ガードルの点 16個（上端・下端） ---
  const GU: Vec3[] = [];
  const GL: Vec3[] = [];
  for (k = 0; k < 16; k++) {
    const ang = (k / 16) * TAU;
    GU.push([R_GIRDLE * Math.cos(ang), Y_GIRDLE_TOP, R_GIRDLE * Math.sin(ang)]);
    GL.push([R_GIRDLE * Math.cos(ang), Y_GIRDLE_BOT, R_GIRDLE * Math.sin(ang)]);
  }
  // GU[偶数] が主方向 A[k]、GU[奇数] が中間方向 B[k] に当たる

  // --- アッパーガードル面 16枚 ---
  // スター頂点 P[k] から、その両隣のガードル点へ下りる三角形
  for (k = 0; k < 8; k++) {
    planes.push(planeFromPoints(P[k], GU[2 * k], GU[2 * k + 1]));
    planes.push(planeFromPoints(P[k], GU[2 * k + 1], GU[(2 * k + 2) % 16]));
  }

  // --- ガードル（胴回り）16枚の垂直な面 ---
  // 16角形の頂点が半径 1.00、平らな面の位置は cos(11.25°) 分だけ内側になる
  const girdleD = R_GIRDLE * Math.cos(TAU / 32);
  for (k = 0; k < 16; k++) {
    c = (k / 16) * TAU + TAU / 32;
    planes.push({ n: [Math.cos(c), 0, Math.sin(c)], d: girdleD });
  }

  // --- パビリオン面 8枚 ---
  // キューレット(0, Y_CULET)からガードル(R_GIRDLE, Y_GIRDLE_BOT)へ上がる直線
  const pdr = R_GIRDLE - 0;
  const pdy = Y_GIRDLE_BOT - Y_CULET;
  const plen = Math.hypot(pdr, pdy);
  const pavNr = pdy / plen;
  const pavNy = -pdr / plen;
  const pavD = pavNr * R_GIRDLE + pavNy * Y_GIRDLE_BOT;
  for (k = 0; k < 8; k++) {
    planes.push(planeFromProfile(A[k], pavNr, pavNy, pavD));
  }

  // --- ロワーガードル面 16枚 ---
  // 両隣のパビリオン面の上に乗る合流点 J[k] を求めてから面を張る
  const J: Vec3[] = [];
  for (k = 0; k < 8; k++) {
    const yJ = (pavD - pavNr * R_JUNCTION * cos225) / pavNy;
    J.push([R_JUNCTION * Math.cos(B[k]), yJ, R_JUNCTION * Math.sin(B[k])]);
  }
  for (k = 0; k < 8; k++) {
    planes.push(planeFromPoints(J[k], GL[2 * k], GL[2 * k + 1]));
    planes.push(planeFromPoints(J[k], GL[2 * k + 1], GL[(2 * k + 2) % 16]));
  }

  return planes;
}

/* ===========================================================================
 * 2. 平面を切り合わせて多面体の面を作る
 *    「大きな板を、他の全部の平面で切り落としていく」だけ。
 *    メッシュとシェーダが同じ平面を見ているので、絵と計算がずれない。
 * ======================================================================== */

function clipPolygonByPlane(poly: Vec3[], pl: Plane): Vec3[] {
  const out: Vec3[] = [];
  const n = poly.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const sa = pl.d - dot(pl.n, a); // 0以上なら内側
    const sb = pl.d - dot(pl.n, b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push(mix3(a, b, t));
    }
  }
  return out;
}

// 隣の面がちょうど角を掠めた所に、同じ位置の点が二重にできる。
// 潰れた三角形を作らないよう、重なった点と一直線に並んだ点を落とす。
function cleanPolygon(poly: Vec3[]): Vec3[] {
  let i: number;
  let a: Vec3;
  let b: Vec3;
  let c: Vec3;
  const out: Vec3[] = [];
  for (i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (out.length && Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1], p[2] - out[out.length - 1][2]) < 1e-7) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1], f[2] - l[2]) < 1e-7) out.pop();
    else break;
  }
  if (out.length < 3) return [];
  const res: Vec3[] = [];
  for (i = 0; i < out.length; i++) {
    a = out[(i - 1 + out.length) % out.length];
    b = out[i];
    c = out[(i + 1) % out.length];
    const area = Math.hypot(...cross(sub(b, a), sub(c, a)));
    if (area > 1e-9) res.push(b);
  }
  return res.length >= 3 ? res : [];
}

function buildSolid(): Solid {
  const planes = buildPlanes();
  const faces: Face[] = [];
  const BIG = 6;
  for (let i = 0; i < planes.length; i++) {
    const pl = planes[i];
    // 面の上に平面の座標軸を作る
    const helper: Vec3 = Math.abs(pl.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(pl.n, helper));
    const v = cross(pl.n, u);
    const c: Vec3 = [pl.n[0] * pl.d, pl.n[1] * pl.d, pl.n[2] * pl.d];
    let poly: Vec3[] = [
      [c[0] - (u[0] + v[0]) * BIG, c[1] - (u[1] + v[1]) * BIG, c[2] - (u[2] + v[2]) * BIG],
      [c[0] + (u[0] - v[0]) * BIG, c[1] + (u[1] - v[1]) * BIG, c[2] + (u[2] - v[2]) * BIG],
      [c[0] + (u[0] + v[0]) * BIG, c[1] + (u[1] + v[1]) * BIG, c[2] + (u[2] + v[2]) * BIG],
      [c[0] - (u[0] - v[0]) * BIG, c[1] - (u[1] - v[1]) * BIG, c[2] - (u[2] - v[2]) * BIG],
    ];
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      poly = clipPolygonByPlane(poly, planes[j]);
    }
    poly = cleanPolygon(poly);
    if (poly.length >= 3) faces.push({ n: pl.n, d: pl.d, poly: poly });
  }
  return { planes: planes, faces: faces };
}

// 面ごとに平らな法線を持つ三角形の並びへ（頂点法線を平均しない）
function solidToArrays(solid: Solid): { position: Float32Array; normal: Float32Array; verts: Vec3[] } {
  const pos: number[] = [];
  const nrm: number[] = [];
  const verts: Vec3[] = [];
  for (let f = 0; f < solid.faces.length; f++) {
    const face = solid.faces[f];
    const p = face.poly;
    for (let i = 0; i < p.length; i++) verts.push(p[i]);
    for (let t = 1; t + 1 < p.length; t++) {
      const tri = [p[0], p[t], p[t + 1]];
      for (let q = 0; q < 3; q++) {
        pos.push(tri[q][0], tri[q][1], tri[q][2]);
        nrm.push(face.n[0], face.n[1], face.n[2]);
      }
    }
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    verts: verts,
  };
}

/* ===========================================================================
 * 3. 画面に収まる大きさを先に計算しておく
 *    多面体を回すと見かけの幅が変わるので、全ステップの中で
 *    一番はみ出す姿勢を探して、そこを基準に枠を決める。
 * ======================================================================== */

function rotatePoint(p: Vec3, tilt: number, spin: number): Vec3 {
  // まず X 軸まわりに倒し（テーブル面をカメラ側へ）、次に Y 軸まわりに回す
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const y1 = p[1] * ct - p[2] * st;
  const z1 = p[1] * st + p[2] * ct;
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const x2 = p[0] * cs + z1 * ss;
  const z2 = -p[0] * ss + z1 * cs;
  return [x2, y1, z2];
}

type Fit = { cx: number; cy: number; half: number };

function screenBounds(verts: Vec3[], steps: number, tilt: number): Fit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < steps; i++) {
    const spin = (i / steps) * Math.PI * 2;
    for (let v = 0; v < verts.length; v++) {
      const q = rotatePoint(verts[v], tilt, spin);
      if (q[0] < minX) minX = q[0];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(maxX - cx, cx - minX, maxY - cy, cy - minY);
  return { cx: cx, cy: cy, half: half };
}

/* ===========================================================================
 * 4. 環境（スタジオ）を canvas で描く
 *    実写の環境画像は使えないので、暗い部屋に白い帯を数本と
 *    うっすらした虹色の帯を置いた擬似的なスタジオを自分で描く。
 *    横方向が方位、縦方向が上下。上端が真上。
 * ======================================================================== */

function dirToUV(d: Vec3): [number, number] {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const x = d[0] / l;
  const y = d[1] / l;
  const z = d[2] / l;
  return [
    Math.atan2(z, x) / (Math.PI * 2) + 0.5,
    Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI,
  ];
}

// 画面に対して固定の光。左上・右上・下からの3灯。
// LIGHT_ANGLE は今までの💎と同じ値をそのまま使っている。
// カメラは +Z から原点を見ているので、+X が画面右、+Y が画面上。
function keyLights(): { dir: Vec3; intensity: number; radius: number }[] {
  const main = norm([Math.cos(LIGHT_ANGLE), -Math.sin(LIGHT_ANGLE), LIGHT_Z]);
  const rim = norm([-0.72, 0.62, 0.3]);
  const fill = norm([-0.35, -0.62, 0.7]);
  return [
    { dir: main, intensity: 1.0, radius: 0.085 },
    { dir: rim, intensity: 0.62, radius: 0.11 },
    { dir: fill, intensity: 0.34, radius: 0.15 },
  ];
}

function paintBlob(ctx: CanvasRenderingContext2D, u: number, v: number, r: number, alpha: number) {
  for (let s = -1; s <= 1; s++) {
    const x = (u + s) * ENV_W;
    const y = v * ENV_H;
    const rad = r * ENV_W;
    if (x + rad < 0 || x - rad > ENV_W) continue;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255," + alpha + ")");
    g.addColorStop(0.35, "rgba(255,255,255," + alpha * 0.55 + ")");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

let envCanvas: HTMLCanvasElement | null = null;
function buildEnvCanvas(): HTMLCanvasElement {
  if (envCanvas) return envCanvas;
  const cv = document.createElement("canvas");
  cv.width = ENV_W;
  cv.height = ENV_H;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("環境の絵を描く用意ができなかった");

  // 下地: 上が少し明るい暗がり、下は床のうっすらした照り返し
  const base = ctx.createLinearGradient(0, 0, 0, ENV_H);
  const floorV = Math.round(255 * Math.sqrt(ENV_FLOOR));
  base.addColorStop(0.0, "rgb(" + Math.round(floorV * 1.25) + "," + Math.round(floorV * 1.3) + "," + Math.round(floorV * 1.45) + ")");
  base.addColorStop(0.45, "rgb(" + Math.round(floorV * 0.7) + "," + Math.round(floorV * 0.72) + "," + Math.round(floorV * 0.85) + ")");
  base.addColorStop(0.62, "rgb(" + Math.round(floorV * 0.55) + "," + Math.round(floorV * 0.55) + "," + Math.round(floorV * 0.62) + ")");
  base.addColorStop(1.0, "rgb(" + Math.round(floorV * 1.05) + "," + Math.round(floorV * 1.0) + "," + Math.round(floorV * 0.95) + ")");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, ENV_W, ENV_H);

  ctx.globalCompositeOperation = "lighter";

  // うっすらした虹色の帯（分散した光が拾う色の素）
  const rb = ctx.createLinearGradient(0, 0, ENV_W, 0);
  const hues = ["#ff3b3b", "#ffb03b", "#ffff5a", "#5aff8a", "#5ad9ff", "#7a6bff", "#ff5ad0", "#ff3b3b"];
  for (let h = 0; h < hues.length; h++) rb.addColorStop(h / (hues.length - 1), hues[h]);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = rb;
  ctx.fillRect(0, ENV_H * 0.30, ENV_W, ENV_H * 0.16);
  ctx.globalAlpha = 0.10;
  ctx.fillRect(0, ENV_H * 0.60, ENV_W, ENV_H * 0.10);
  ctx.globalAlpha = 1;

  // 白い帯（天井のライトバンク）。石の面が拾うと細い筋の光になる
  const bands = [
    { v: 0.10, h: 0.055, a: 1.0 },
    { v: 0.235, h: 0.030, a: 0.85 },
    { v: 0.40, h: 0.018, a: 0.6 },
    { v: 0.80, h: 0.022, a: 0.45 },
  ];
  for (let i = 0; i < bands.length; i++) {
    const bd = bands[i];
    const y0 = (bd.v - bd.h) * ENV_H;
    const y1 = (bd.v + bd.h) * ENV_H;
    const bg = ctx.createLinearGradient(0, y0, 0, y1);
    bg.addColorStop(0, "rgba(255,255,255,0)");
    bg.addColorStop(0.5, "rgba(255,255,255," + bd.a + ")");
    bg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, y0, ENV_W, y1 - y0);
  }

  // 光の来る側を作る。画面の右にあたる向きを明るく、左にあたる向きを暗くする。
  // これが無いと部屋の明かりが全方位おなじ強さになり、明暗の左右差が消える。
  ctx.globalCompositeOperation = "multiply";
  const sideGrad = ctx.createLinearGradient(0, 0, ENV_W, 0);
  const SIDE_FLOOR = 0.45;
  for (let su = 0; su <= 24; su++) {
    const uu = su / 24;
    const wgt = SIDE_FLOOR + (1 - SIDE_FLOOR) * (0.5 + 0.5 * Math.cos((uu - 0.5) * Math.PI * 2));
    const vv = Math.round(255 * wgt);
    sideGrad.addColorStop(uu, "rgb(" + vv + "," + vv + "," + vv + ")");
  }
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, 0, ENV_W, ENV_H);
  ctx.globalCompositeOperation = "lighter";

  // 主光源（画面に対して固定の3灯）を、方向から求めた位置に置く
  const lights = keyLights();
  for (let k = 0; k < lights.length; k++) {
    const uv = dirToUV(lights[k].dir);
    paintBlob(ctx, uv[0], uv[1], lights[k].radius, lights[k].intensity);
    // 芯を強く（白飛びの核）
    paintBlob(ctx, uv[0], uv[1], lights[k].radius * 0.32, lights[k].intensity);
  }

  ctx.globalCompositeOperation = "source-over";
  envCanvas = cv;
  return cv;
}

/* ===========================================================================
 * 5. 計算式（シェーダ）
 * ======================================================================== */

// 借り物の道具箱を使わない分、宣言は自分で並べる。
// 屈折・全反射・分散の計算そのものは一字も変えていない。
// 最後の合成だけ、石の身に BODY_GAIN を掛ける形になっている。
// これは見本 picker.html と同じ掛け方。
const VERT = [
  "precision highp float;",
  "uniform mat4 projectionMatrix;",
  "uniform mat4 modelViewMatrix;",
  "uniform mat4 modelMatrix;",
  "uniform mat4 viewMatrix;",
  "uniform mat3 normalMatrix;",
  "uniform vec3 cameraPosition;",
  "attribute vec3 position;",
  "attribute vec3 normal;",
  "varying vec3 vPosObj;",
  "varying vec3 vNrmObj;",
  "void main() {",
  "  vPosObj = position;",
  "  vNrmObj = normal;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

function fragmentSource(nPlanes: number): string {
  return [
    "#define NPLANES " + nPlanes,
    "#define BOUNCES " + BOUNCES,
    "#define NLIGHTS 3",
    "precision highp float;",
    "",
    "uniform vec4 uPlanes[NPLANES];   // xyz=法線, w=原点からの距離",
    "uniform sampler2D uEnv;",
    "uniform mat3 uO2W;               // 石の座標 -> 世界の座標（回転のみ）",
    "uniform vec3 uViewObj;           // 視線の進む向き（石の座標）",
    "uniform vec3 uAbsorb;            // 石の身の吸収（メンバーカラー由来）",
    "uniform vec3 uHue;               // メンバーカラーの色味だけ取り出したもの",
    "uniform vec3 uKeyDir[NLIGHTS];",
    "uniform float uKeyInt[NLIGHTS];",
    "",
    "varying vec3 vPosObj;",
    "varying vec3 vNrmObj;",
    "",
    "const float IOR_R = " + IOR_R.toFixed(4) + ";",
    "const float IOR_G = " + IOR_G.toFixed(4) + ";",
    "const float IOR_B = " + IOR_B.toFixed(4) + ";",
    // 空気からダイヤへ入るときの反射率 F0 = ((n-1)/(n+1))^2 = 0.172
    "const float F0 = 0.172;",
    "const float ENV_GAIN = " + ENV_GAIN.toFixed(4) + ";",
    "const float HDR_BOOST = " + HDR_BOOST.toFixed(4) + ";",
    "const float FLASH_TIGHT = " + FLASH_TIGHT.toFixed(1) + ";",
    "const float FLASH_GAIN = " + FLASH_GAIN.toFixed(4) + ";",
    "const float EXPOSURE = " + EXPOSURE.toFixed(4) + ";",
    "const float BODY_GAIN = " + BODY_GAIN.toFixed(4) + ";",
    "const float TRANSMIT_FLOOR = " + TRANSMIT_FLOOR.toFixed(4) + ";",
    "const float BODY_AMBIENT = " + BODY_AMBIENT.toFixed(4) + ";",
    "const float MIN_ALPHA = " + MIN_ALPHA.toFixed(4) + ";",
    "const float EPS = 0.0015;",
    "",
    // 方向から環境画像を引く。画像は 0..1 しか持てないので、
    // 明るい所だけ持ち上げて写真の白飛び相当の眩しさを作る。
    "vec3 envHDR(vec3 dir) {",
    "  vec3 d = normalize(dir);",
    "  vec2 h = vec2(d.x, d.z);",
    "  if (dot(h, h) < 1.0e-12) h = vec2(1.0, 0.0);", // 真上・真下を向いた時に atan が壊れるのを防ぐ
    "  vec2 uv = vec2(atan(h.y, h.x) * 0.15915494 + 0.5,",
    "                 acos(clamp(d.y, -1.0, 1.0)) * 0.31830989);",
    "  vec3 c = texture2D(uEnv, uv).rgb;",
    "  c = c * c;",                     // ざっくり線形に戻す
    "  float m = max(max(c.r, c.g), c.b);",
    "  c += c * max(m - 0.72, 0.0) * HDR_BOOST;",
    "  return c * ENV_GAIN;",
    "}",
    "",
    "float schlick(float cosT) {",
    "  float m = clamp(1.0 - cosT, 0.0, 1.0);",
    "  float m2 = m * m;",
    "  return F0 + (1.0 - F0) * m2 * m2 * m;",
    "}",
    "",
    // 石の中を進む光の出口を探す。石は平面の内側なので、
    // 前を向いている平面のうち一番手前が出口になる。
    "void findExit(vec3 p, vec3 d, out float tOut, out vec3 nOut) {",
    "  tOut = 1.0e9;",
    "  nOut = vec3(0.0, 1.0, 0.0);",
    "  for (int i = 0; i < NPLANES; i++) {",
    "    vec4 pl = uPlanes[i];",
    "    float dn = dot(pl.xyz, d);",
    "    if (dn > 1.0e-6) {",
    "      float t = (pl.w - dot(pl.xyz, p)) / dn;",
    "      if (t > 1.0e-4 && t < tOut) { tOut = t; nOut = pl.xyz; }",
    "    }",
    "  }",
    "}",
    "",
    "void main() {",
    "  vec3 N = normalize(vNrmObj);",
    "  vec3 V = normalize(uViewObj);",           // 視線が進む向き
    "  if (dot(N, V) > 0.0) N = -N;",           // 法線は必ずカメラ側を向かせる
    "  vec3 Nw = normalize(uO2W * N);",
    "  vec3 Vw = normalize(uO2W * V);",
    "",
    "  // ---- 表面で跳ね返った光。これは白のまま。色を掛けない ----",
    "  float cosI = clamp(dot(-Vw, Nw), 0.0, 1.0);",
    "  float F = schlick(cosI);",
    "  vec3 Rw = reflect(Vw, Nw);",
    "  vec3 spec = envHDR(Rw) * F;",
    "",
    "  // 面が光をまっすぐ返した瞬間の閃光",
    "  float flash = 0.0;",
    "  for (int k = 0; k < NLIGHTS; k++) {",
    "    flash += uKeyInt[k] * pow(max(dot(Rw, uKeyDir[k]), 0.0), FLASH_TIGHT);",
    "  }",
    "  spec += vec3(flash) * FLASH_GAIN * (0.35 + 0.65 * F);",
    "",
    "  // ---- 石の身を通ってきた光。ここにだけメンバーカラーを乗せる ----",
    "  vec3 body = vec3(0.0);",
    "  vec3 d = refract(V, N, 1.0 / IOR_G);",
    "  if (dot(d, d) > 0.0) {",
    "    d = normalize(d);",
    "    vec3 p = vPosObj - N * EPS;",
    "    float through = 1.0;",
    "    float pathLen = 0.0;",
    "    for (int b = 0; b < BOUNCES; b++) {",
    "      float t; vec3 nEx;",
    "      findExit(p, d, t, nEx);",
    "      if (t > 1.0e8) { through = 0.0; break; }",
    "      p += d * t;",
    "      pathLen += t;",
    "      // 厚みのある所ほど濃く、薄い所ほど淡く",
    "      vec3 absorbT = max(exp(-uAbsorb * pathLen), uHue * TRANSMIT_FLOOR);",
    "      float c = clamp(dot(d, nEx), 0.0, 1.0);",
    "      float sin2t = IOR_G * IOR_G * (1.0 - c * c);",
    "      float Rf;",
    "      if (sin2t >= 1.0) {",
    "        Rf = 1.0;",                        // 全反射。外へは一切出ない
    "      } else {",
    "        float cosT = sqrt(1.0 - sin2t);",
    "        Rf = schlick(cosT);",
    "        // 分散: 赤・緑・青で屈折率をずらし、別々の向きで環境を拾う",
    "        vec3 nIn = -nEx;",
    "        vec3 oR = refract(d, nIn, IOR_R);",
    "        vec3 oG = refract(d, nIn, IOR_G);",
    "        vec3 oB = refract(d, nIn, IOR_B);",
    "        // 全反射の境目では、屈折率の大きい青から順に外へ出られなくなる。",
    "        // 出られなかった色は 0 のまま残す。これが縁に出る虹の色付きになる",
    "        vec3 col = vec3(0.0);",
    "        if (dot(oR, oR) > 0.0) col.r = envHDR(uO2W * oR).r;",
    "        if (dot(oG, oG) > 0.0) col.g = envHDR(uO2W * oG).g;",
    "        if (dot(oB, oB) > 0.0) col.b = envHDR(uO2W * oB).b;",
    "        body += through * (1.0 - Rf) * col * absorbT;",
    "      }",
    "      through *= Rf;",
    "      if (through < 0.02) break;",
    "      d = reflect(d, nEx);",
    "      p += d * EPS;",
    "    }",
    "    if (through > 0.02) {",
    "      // 跳ね返り上限で打ち切った分。残りをまとめて足しておく",
    "      vec3 absorbT = max(exp(-uAbsorb * pathLen), uHue * TRANSMIT_FLOOR);",
    "      body += through * envHDR(uO2W * d) * absorbT * 0.6;",
    "    }",
    "  }",
    "",
    "  // 影の側を黒く潰さないための底上げ。反射の白には足さない",
    "  body += uHue * BODY_AMBIENT;",
    "",
    "  vec3 col = spec + body * BODY_GAIN * (1.0 - F);",
    "  col = vec3(1.0) - exp(-col * EXPOSURE);",
    "  col = pow(max(col, vec3(0.0)), vec3(0.4545));",
    "",
    "  float lum = dot(col, vec3(0.299, 0.587, 0.114));",
    "  float a = mix(MIN_ALPHA, 1.0, clamp(lum * 2.5, 0.0, 1.0));",
    "  gl_FragColor = vec4(col * a, a);",   // 乗算済みアルファで出す
    "}",
  ].join("\n");
}

/* ===========================================================================
 * 6. 描く道具を一式だけ作って使い回す
 *    色ごとに作り直すと、ブラウザが同時に持てる描画面の上限に当たって
 *    途中から真っ黒になる。だから一式だけ作って使い回す。
 * ======================================================================== */

// カメラの決めごと。正射影で、石から 8 だけ離れた所から見ている。
const CAM_Z = 8;
const CAM_NEAR = 0.1;
const CAM_FAR = 100;

type Loc = {
  position: number;
  normal: number;
  projectionMatrix: WebGLUniformLocation | null;
  modelViewMatrix: WebGLUniformLocation | null;
  uPlanes: WebGLUniformLocation | null;
  uEnv: WebGLUniformLocation | null;
  uO2W: WebGLUniformLocation | null;
  uViewObj: WebGLUniformLocation | null;
  uAbsorb: WebGLUniformLocation | null;
  uHue: WebGLUniformLocation | null;
  uKeyDir: WebGLUniformLocation | null;
  uKeyInt: WebGLUniformLocation | null;
};

type Gear = {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  loc: Loc;
  count: number;
  verts: Vec3[];
  size: number;
  fitCache: Record<string, Fit>;
  proj: Float32Array;
  mv: Float32Array;
  o2w: Float32Array;
  viewObj: Float32Array;
};

let gear: Gear | null = null;
let gearFailed = false;
let gearFailReason = "";
let initMs = 0;

function now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

// 描画面を1枚だけ用意する。新しい方から順に試し、駄目なら古い作法へ下りる。
function createContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const attrs: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  };
  const names = ["webgl2", "webgl", "experimental-webgl"];
  for (let i = 0; i < names.length; i++) {
    let ctx: unknown = null;
    try {
      ctx = canvas.getContext(names[i], attrs);
    } catch {
      ctx = null;
    }
    if (ctx) return ctx as WebGLRenderingContext;
  }
  return null;
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(label + "の計算式を置く場所が作れなかった");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "";
    gl.deleteShader(sh);
    throw new Error(label + "の計算式が通らなかった: " + log);
  }
  return sh;
}

function buildProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, "形");
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, "色");
  const prog = gl.createProgram();
  if (!prog) throw new Error("計算式を置く場所が作れなかった");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || "";
    gl.deleteProgram(prog);
    throw new Error("計算式を組み上げられなかった: " + log);
  }
  return prog;
}

// 頂点の並びを 1 本の帯としてまとめて置き、番号を割り当てる
function makeAttribBuffer(gl: WebGLRenderingContext, data: Float32Array, loc: number): WebGLBuffer | null {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  return buf;
}

function buildGear(): Gear | null {
  if (gear || gearFailed) return gear;
  const t0 = now();
  try {
    const canvas = document.createElement("canvas");
    const gl = createContext(canvas);
    if (!gl) throw new Error("この端末では宝石を描く用意ができませんでした");

    // 描画面が取り上げられたら（端末の都合で起きる）、以後は今までの描き方へ下りる。
    // 既に焼き終わった絵は普通の canvas なので、そのまま使い続けられる。
    canvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      gearFailed = true;
      gearFailReason = "宝石を描く場所が端末の都合で失われました";
      gear = null;
      console.warn("[灰toダイヤモンド] 宝石を描く場所が失われた。以後は今までの描き方に戻す");
    });

    const solid = buildSolid();
    const arrays = solidToArrays(solid);

    const program = buildProgram(gl, VERT, fragmentSource(solid.planes.length));
    gl.useProgram(program);

    const loc: Loc = {
      position: gl.getAttribLocation(program, "position"),
      normal: gl.getAttribLocation(program, "normal"),
      projectionMatrix: gl.getUniformLocation(program, "projectionMatrix"),
      modelViewMatrix: gl.getUniformLocation(program, "modelViewMatrix"),
      uPlanes: gl.getUniformLocation(program, "uPlanes[0]"),
      uEnv: gl.getUniformLocation(program, "uEnv"),
      uO2W: gl.getUniformLocation(program, "uO2W"),
      uViewObj: gl.getUniformLocation(program, "uViewObj"),
      uAbsorb: gl.getUniformLocation(program, "uAbsorb"),
      uHue: gl.getUniformLocation(program, "uHue"),
      uKeyDir: gl.getUniformLocation(program, "uKeyDir[0]"),
      uKeyInt: gl.getUniformLocation(program, "uKeyInt[0]"),
    };
    if (loc.position < 0 || loc.normal < 0) {
      throw new Error("宝石の形を渡す口が見つからなかった");
    }

    makeAttribBuffer(gl, arrays.position, loc.position);
    makeAttribBuffer(gl, arrays.normal, loc.normal);

    // 環境（スタジオ）の絵を、そのまま画像として渡す。
    // 上下は端で止め、横はぐるりと繋げる。1行目を真上として使うので上下は反転させない。
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildEnvCanvas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(loc.uEnv, 0);

    // 形を決めている 73 枚の平面。焼いている間ずっと同じなので一度だけ渡す
    const planeData = new Float32Array(solid.planes.length * 4);
    for (let i = 0; i < solid.planes.length; i++) {
      const pl = solid.planes[i];
      planeData[i * 4 + 0] = pl.n[0];
      planeData[i * 4 + 1] = pl.n[1];
      planeData[i * 4 + 2] = pl.n[2];
      planeData[i * 4 + 3] = pl.d;
    }
    gl.uniform4fv(loc.uPlanes, planeData);

    // 画面に対して固定の3灯。これも焼いている間ずっと同じ
    const lights = keyLights();
    const keyDir = new Float32Array(lights.length * 3);
    const keyInt = new Float32Array(lights.length);
    for (let k = 0; k < lights.length; k++) {
      keyDir[k * 3 + 0] = lights[k].dir[0];
      keyDir[k * 3 + 1] = lights[k].dir[1];
      keyDir[k * 3 + 2] = lights[k].dir[2];
      keyInt[k] = lights[k].intensity;
    }
    gl.uniform3fv(loc.uKeyDir, keyDir);
    gl.uniform1fv(loc.uKeyInt, keyInt);

    // 描き方の決めごと。
    //   奥行きの前後関係を見る / 手前ほど採る
    //   重ね塗りはしない（下地と混ぜず、そのまま置く）
    //   石の裏側を向いている面は描かない
    //   透明で塗り潰してから描く
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);

    gear = {
      gl: gl,
      canvas: canvas,
      program: program,
      loc: loc,
      count: arrays.position.length / 3,
      verts: arrays.verts,
      size: 0,
      fitCache: {},
      proj: new Float32Array(16),
      mv: new Float32Array(16),
      o2w: new Float32Array(9),
      viewObj: new Float32Array(3),
    };

    // 計算式の翻訳は、放っておくと最初に描く瞬間に起きる。
    // そうすると「1色目だけ極端に遅い」ように見えて、焼き時間の判断を誤らせる。
    // ここで一度だけ小さく描いて、その支度を先に済ませておく。
    warmUp(gear);

    initMs = now() - t0;
  } catch (e) {
    console.warn("[灰toダイヤモンド] 宝石の支度に失敗した:", e);
    gearFailReason = e instanceof Error ? e.message : String(e);
    gearFailed = true;
    gear = null;
  }
  return gear;
}

/** 計算式の翻訳を「はじめる」より前に済ませておくための、捨てる1枚 */
function warmUp(g: Gear) {
  const gl = g.gl;
  const tilt = (TILT_DEG * Math.PI) / 180;
  const fit = screenBounds(g.verts, 8, tilt);
  g.canvas.width = 8;
  g.canvas.height = 8;
  g.size = 8;
  gl.viewport(0, 0, 8, 8);
  gl.uniformMatrix4fv(g.loc.projectionMatrix, false, setOrtho(g.proj, fit.half / FIT));
  gl.uniform3f(g.loc.uAbsorb, 0, 0, 0);
  gl.uniform3f(g.loc.uHue, 1, 1, 1);
  setPose(g, 0, tilt, fit.cx, fit.cy);
  gl.uniformMatrix4fv(g.loc.modelViewMatrix, false, g.mv);
  gl.uniformMatrix3fv(g.loc.uO2W, false, g.o2w);
  gl.uniform3f(g.loc.uViewObj, g.viewObj[0], g.viewObj[1], g.viewObj[2]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, g.count);
  gl.finish();
}

/* ---------------------------------------------------------------------------
 * カメラと石の姿勢を、4x4 と 3x3 の数の並びとして自分で組む
 * ------------------------------------------------------------------------ */

// 正射影。奥行きで大きさが変わらない見え方。左右上下は ±half に収める
function setOrtho(m: Float32Array, half: number): Float32Array {
  for (let i = 0; i < 16; i++) m[i] = 0;
  m[0] = 1 / half;
  m[5] = 1 / half;
  m[10] = -2 / (CAM_FAR - CAM_NEAR);
  m[14] = -(CAM_FAR + CAM_NEAR) / (CAM_FAR - CAM_NEAR);
  m[15] = 1;
  return m;
}

// 石の姿勢。まず横軸まわりに倒し、次に画面の縦軸まわりに回す。
// 上の rotatePoint と同じ順番・同じ向きなので、枠決めの計算と結果がぴったり重なる。
function setPose(g: Gear, spin: number, tilt: number, cx: number, cy: number) {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);

  const r00 = cs, r01 = ss * st, r02 = ss * ct;
  const r10 = 0, r11 = ct, r12 = -st;
  const r20 = -ss, r21 = cs * st, r22 = cs * ct;

  const mv = g.mv;
  // 数の並びは縦一列ずつ入れる決まりになっている
  mv[0] = r00; mv[1] = r10; mv[2] = r20; mv[3] = 0;
  mv[4] = r01; mv[5] = r11; mv[6] = r21; mv[7] = 0;
  mv[8] = r02; mv[9] = r12; mv[10] = r22; mv[11] = 0;
  // カメラの位置ぶんだけ石をずらす
  mv[12] = -cx; mv[13] = -cy; mv[14] = -CAM_Z; mv[15] = 1;

  const o2w = g.o2w;
  o2w[0] = r00; o2w[1] = r10; o2w[2] = r20;
  o2w[3] = r01; o2w[4] = r11; o2w[5] = r21;
  o2w[6] = r02; o2w[7] = r12; o2w[8] = r22;

  // 視線は世界で (0,0,-1)。石の座標へ戻すのは逆回転で、回転だけなので縦横を入れ替えれば済む
  const v = g.viewObj;
  v[0] = -r20; v[1] = -r21; v[2] = -r22;
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
}

/* ===========================================================================
 * 7. 色の作り方
 *    「石の身は色付き、表面の反射は白のまま」を保つため、
 *    メンバーカラーは吸収の量としてだけ使う。
 *    白 #ffffff は吸収ゼロ = 無色のダイヤそのものになる。
 * ======================================================================== */

function hexToAbsorb(hex: string): { hue: Vec3; absorb: Vec3 } {
  let h = String(hex).replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  let r = parseInt(h.substr(0, 2), 16) / 255;
  let g = parseInt(h.substr(2, 2), 16) / 255;
  let b = parseInt(h.substr(4, 2), 16) / 255;
  if (!isFinite(r) || !isFinite(g) || !isFinite(b)) {
    r = g = b = 1;
  }
  // 明るさの違いをそろえて「色味」だけ取り出す。
  // これをしないと濃い色が黒い塊、明るい色が白い塊になる。
  const lin = [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
  const m = Math.max(lin[0], lin[1], lin[2], 1e-4);
  const hue: Vec3 = [
    lin[0] / m + (1 - lin[0] / m) * HUE_LIFT,
    lin[1] / m + (1 - lin[1] / m) * HUE_LIFT,
    lin[2] / m + (1 - lin[2] / m) * HUE_LIFT,
  ];
  const absorb: Vec3 = [
    (1 - hue[0]) * ABSORB_K,
    (1 - hue[1]) * ABSORB_K,
    (1 - hue[2]) * ABSORB_K,
  ];
  return { hue: hue, absorb: absorb };
}

/* ===========================================================================
 * 8. 焼く（途中で中断して続きから再開できる形）
 *
 *    1色ぶん（48枚）を一気に焼くと、その間だけ画面が固まる。
 *    そこで「持ち時間ぶんだけ焼いて、いったん返す」形にし、
 *    呼ぶ側が細切れに回せるようにしてある。
 * ======================================================================== */

function makeCanvas(px: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = px;
  cv.height = px;
  return cv;
}

export type BakeJob = {
  /** 焼く枚数 */
  readonly steps: number;
  /** 焼き終わった枚数 */
  readonly done: number;
  /** 全部焼き終わったか */
  readonly finished: boolean;
  /** 焼くのに使った時間の合計(ms)。finished になった時点が1色ぶんの実測値 */
  readonly ms: number;
  /** 出来上がった絵。finished になるまで中身は不揃いなので、外から覗かないこと */
  readonly frames: HTMLCanvasElement[];
  /** budgetMs の持ち時間ぶんだけ焼き進める。最低でも1枚は焼く */
  advance(budgetMs: number): void;
};

class Baker implements BakeJob {
  readonly steps: number;
  readonly frames: HTMLCanvasElement[] = [];
  done = 0;
  ms = 0;
  private hex: string;
  private px: number;
  private tilt: number;
  private fit: Fit;

  constructor(hex: string, steps: number, px: number, g: Gear) {
    this.hex = hex;
    this.steps = steps;
    this.px = px;
    this.tilt = (TILT_DEG * Math.PI) / 180;
    // 枠決め: 一番幅が広くなる姿勢でもはみ出さないようにする
    const key = steps + "@" + TILT_DEG;
    let fit = g.fitCache[key];
    if (!fit) {
      fit = screenBounds(g.verts, steps, this.tilt);
      g.fitCache[key] = fit;
    }
    this.fit = fit;
  }

  get finished(): boolean {
    return this.done >= this.steps;
  }

  /** 焼く前に、この石の色と大きさで描く設定を入れ直す。
   *  細切れに焼くので、間に他の色が挟まっても大丈夫なように毎回入れ直す */
  private arm(g: Gear) {
    const gl = g.gl;
    gl.useProgram(g.program);
    gl.uniformMatrix4fv(g.loc.projectionMatrix, false, setOrtho(g.proj, this.fit.half / FIT));
    const inner = Math.max(8, Math.round(this.px * SUPERSAMPLE));
    if (g.size !== inner) {
      g.canvas.width = inner;
      g.canvas.height = inner;
      g.size = inner;
    }
    gl.viewport(0, 0, inner, inner);
    const col = hexToAbsorb(this.hex);
    gl.uniform3f(g.loc.uAbsorb, col.absorb[0], col.absorb[1], col.absorb[2]);
    gl.uniform3f(g.loc.uHue, col.hue[0], col.hue[1], col.hue[2]);
  }

  advance(budgetMs: number) {
    if (this.finished) return;
    const g = gear;
    if (!g) throw new Error(gearFailReason || "宝石を描く用意ができていません");
    const gl = g.gl;
    const t0 = now();
    this.arm(g);
    let first = true;
    while (this.done < this.steps) {
      const i = this.done;
      const spin = (i / this.steps) * Math.PI * 2;
      setPose(g, spin, this.tilt, this.fit.cx, this.fit.cy);
      gl.uniformMatrix4fv(g.loc.modelViewMatrix, false, g.mv);
      gl.uniformMatrix3fv(g.loc.uO2W, false, g.o2w);
      gl.uniform3f(g.loc.uViewObj, g.viewObj[0], g.viewObj[1], g.viewObj[2]);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, g.count);

      // 何も写っていない場合の見張り。計算式が通らなかった時の唯一の手掛かりなので、
      // ひと区切りごとに最初の1枚を確かめる（描画面が途中で失われた時にも引っかかる）
      if (first) {
        first = false;
        const px4 = new Uint8Array(4);
        const mid = Math.floor(g.size / 2);
        gl.readPixels(mid, mid, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px4);
        if (px4[3] === 0) throw new Error("この端末では宝石の絵を作れませんでした");
      }

      const cv = makeCanvas(this.px);
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("宝石の絵を写す場所が作れませんでした");
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      ctx.drawImage(g.canvas, 0, 0, this.px, this.px);
      this.frames.push(cv);
      this.done++;

      if (now() - t0 >= budgetMs) break;
    }
    this.ms += now() - t0;

    if (this.finished) {
      console.log(
        "[灰toダイヤモンド 本物レンダリング] " +
          this.hex +
          " steps=" + this.steps +
          " px=" + this.px +
          " 内部=" + Math.round(this.px * SUPERSAMPLE) + "px : " +
          this.ms.toFixed(1) + "ms" +
          (initMs > 0
            ? " ※これとは別に、画面を開いた直後の支度が " + initMs.toFixed(1) +
              "ms かかっている。内訳は形の組み立て・環境の描画・計算式の組み上げ"
            : "")
      );
      initMs = 0; // 準備の時間は最初の1色にだけ出す
    }
  }
}

/* ===========================================================================
 * 9. 受け渡し口
 * ======================================================================== */

/** 描く道具を先に用意しておく（「はじめる」を押す前に呼ぶ）。用意できたら true */
export function prepareGemRenderer(): boolean {
  return buildGear() !== null;
}

/** この端末で本物の描き方が使えるか。false なら今までの描き方へ下りる */
export function isGemRendererAvailable(): boolean {
  if (gearFailed) return false;
  return buildGear() !== null;
}

/** 1色ぶんの焼き込みを始める。使えない端末では null を返す（例外は投げない） */
export function startBake(hex: string, steps: number, px: number): BakeJob | null {
  const g = buildGear();
  if (!g) return null;
  try {
    return new Baker(hex, steps, px, g);
  } catch (e) {
    console.warn("[灰toダイヤモンド] 焼き込みを始められなかった:", e);
    return null;
  }
}
