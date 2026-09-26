// 灰toダイヤモンド「原石の版」— 原石とダイヤの形（幾何）。画面にも DOM にも触らない純粋な計算だけ。
//
// ここが決めること:
//   1. ダイヤの形 … ラウンドブリリアントカット（丸い宝石のいちばん普通の削り方）をプログラムで組み立てる
//   2. 原石の形 … ダイヤの各頂点を外へ押し出した、ゴツゴツした灰色の塊。必ずダイヤを包む
//   3. 削れる順番 … 面ごとの cutRank（0..1）。腰の帯と上の腰の三角 → 上下の大きな面と下の腰の三角を混ぜて → テーブル → 尖り
//   4. 毎コマの形 … 面ごとの削れ具合から、原石とダイヤの間の頂点の位置を作る（morphVertices）
//
// 座標: y が上。テーブル（上の平らな面）が +y、尖り（culet）が -y。
// 原点はダイヤの高さの真ん中【仮】（回転の軸がダイヤの真ん中を通り、画面の中心に石の中心が来るように）。
// ダイヤは半径およそ1の球に収まる（腰の端がいちばん遠く、約1.04）。
//
// 面の数: table 1・star 8・bezel 8・upperGirdle 16・girdle 16・lowerGirdle 16・pavilion 8・culet 1 = 74 面。
// 宝石の世界で言う「57面（58面）」は腰の帯（girdle）を数えない数え方。ここでは腰の帯も 16 枚の細い面として持つ。
import type { StoneMesh, StoneFace, FaceKind, Vec3 } from "./stoneTypes";

// ─── 形の寸法（ラウンドブリリアントの代表的な比率。腰の半径を1とした値）──────────────
const TABLE_R = 0.57;                        // テーブルの八角形の角までの半径（直径の57%）
const CROWN_ANGLE = (34.5 * Math.PI) / 180;  // クラウン（上半分）の傾き
const PAVILION_ANGLE = (40.75 * Math.PI) / 180; // パビリオン（下半分）の傾き
const GIRDLE_HALF = 0.02;                    // 腰の帯の厚みの半分【仮】（見た目で細い帯が見える程度）
const STAR_FRAC = 0.5;                       // スター面の長さ（テーブルから腰までのどこまで伸びるか）
const LOWER_FRAC = 0.77;                     // 下の腰の三角の長さ（腰から尖りまでのどこまで伸びるか）
const CULET_FRAC = 0.05;                     // 尖りの小さな八角形の大きさ（尖りの点からの比率）【仮】
const C22 = Math.cos(Math.PI / 8);           // 22.5度の cos。凧形の面を平らにするための補正

// ─── 原石の寸法 ──────────────
const ROUGH_R = 1.1;           // 原石の基本の半径（塊の中心から）【仮】
const ROUGH_SQUASH: Vec3 = [1.05, 0.85, 0.95]; // 原石を少しつぶした楕円体にする倍率（x,y,z）【仮】。真ん丸だと石に見えない
const ROUGH_CENTER_Y = -0.2;   // 塊の中心の高さ（腰を0とした高さ）【仮】
const ROUGH_LUMP = 0.2;        // 大きなこぶの強さ【仮】
const ROUGH_JITTER = 0.06;     // 頂点ごとの細かいでこぼこ（距離）【仮】
const ROUGH_ANGLE_JITTER = (5 * Math.PI) / 180; // 頂点ごとの向きのずれ（緯度・方角）【仮】。面の並びの規則正しさを崩す
const ROUGH_MIN_PUSH = 0.06;   // どの頂点も最低これだけは外へ押し出す（ダイヤを必ず包むため）
const CONTAIN_MARGIN = 0.02;   // 原石の面とダイヤの間に最低限あける隙間（包み直しの判定）

// ─── 削れる順番の配分（cutRank の範囲）【仮】──────────────
// 曲の削れ具合 cutFractionAt(t) がこの値を越えたところから、その面が削れ始める
// 下の腰の三角は、最初の組で削ると尖りの手前の頂点だけが先に引っ込み、原石の尖りが「柄」のように垂れ下がった（見本で確認）。
// そのため主な面の組へ移した（2026-09-26 の指示・A案）
const RANK_GIRDLE: [number, number] = [0, 0.2];    // 腰まわり（腰の帯・上の腰の三角）
const RANK_MAIN: [number, number] = [0.22, 0.88];  // クラウンの凧形・スター・パビリオン・下の腰の三角を混ぜる
const RANK_TABLE = 0.91;                           // テーブルは終盤
const RANK_CULET = 0.95;                           // 尖りは最後

/** 決定的な擬似乱数（mulberry32）。同じ種なら毎回同じ並びを返す */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n（2の累乗）個の番号を「ビット反転」の順に並べる。0,8,4,12,2,... のように、続けて出る番号が必ず離れる。
 *  周方向に並んだ面をこの順で削ると、隣同士が続けて削れない */
function bitReverseOrder(n: number): number[] {
  const bits = Math.round(Math.log2(n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    out.push(r);
  }
  return out;
}

/** ラウンドブリリアントのダイヤと原石を作る。seed は原石のでこぼこと、削れ始める位置（周方向）だけを変える */
export function buildStoneMesh(seed = 1): StoneMesh {
  const pts: number[] = [];
  const add = (x: number, y: number, z: number) => { pts.push(x, y, z); return pts.length / 3 - 1; };
  const ang = (k: number) => (k * Math.PI) / 4; // 八方向の角度（k は小数も可）

  // 高さ
  const yTable = GIRDLE_HALF + (1 - TABLE_R) * Math.tan(CROWN_ANGLE);
  const yStar = yTable - STAR_FRAC * (yTable - GIRDLE_HALF);
  const yApex = -GIRDLE_HALF - Math.tan(PAVILION_ANGLE); // 尖りの点（面は小さな八角形なので、この点そのものは頂点にしない）
  const yLower = -GIRDLE_HALF + LOWER_FRAC * (yApex + GIRDLE_HALF);

  // 頂点。凧形の面（bezel・pavilion）が平らになるよう、両脇の頂点は「角→腰」「腰→尖り」の線の上に置き、
  // 22.5度ずれている分を cos で割って補正する
  const T: number[] = [], S: number[] = [], GT: number[] = [], GB: number[] = [], Q: number[] = [], C: number[] = [];
  for (let i = 0; i < 8; i++) T.push(add(TABLE_R * Math.cos(ang(i)), yTable, TABLE_R * Math.sin(ang(i))));
  const rStar = (TABLE_R + (1 - TABLE_R) * STAR_FRAC) / C22;
  for (let i = 0; i < 8; i++) S.push(add(rStar * Math.cos(ang(i + 0.5)), yStar, rStar * Math.sin(ang(i + 0.5))));
  for (let k = 0; k < 16; k++) GT.push(add(Math.cos(ang(k / 2)), GIRDLE_HALF, Math.sin(ang(k / 2))));
  for (let k = 0; k < 16; k++) GB.push(add(Math.cos(ang(k / 2)), -GIRDLE_HALF, Math.sin(ang(k / 2))));
  const rLower = (1 - LOWER_FRAC) / C22;
  for (let i = 0; i < 8; i++) Q.push(add(rLower * Math.cos(ang(i + 0.5)), yLower, rLower * Math.sin(ang(i + 0.5))));
  // 尖りの小さな八角形: 隣り合うパビリオンの境目の線（Q→尖りの点）の上に置くので、パビリオンの面は平らのまま
  for (let i = 0; i < 8; i++) {
    const qx = pts[Q[i] * 3], qy = pts[Q[i] * 3 + 1], qz = pts[Q[i] * 3 + 2];
    C.push(add(qx * CULET_FRAC, yApex + (qy - yApex) * CULET_FRAC, qz * CULET_FRAC));
  }

  // 高さの真ん中を原点へ【仮】
  const mid = (yTable + yApex) / 2;
  for (let v = 1; v < pts.length; v += 3) pts[v] -= mid;
  const fine = new Float32Array(pts);
  const nV = fine.length / 3;

  // 面。slot は周方向の位置（削れる順番を散らすのに使う。型には載せず、ここだけで使う）
  const faces: StoneFace[] = [];
  const slots: number[] = [];
  const face = (kind: FaceKind, slot: number, verts: number[]) => { faces.push({ verts, kind, cutRank: 0 }); slots.push(slot); };
  const m8 = (i: number) => ((i % 8) + 8) % 8;
  const m16 = (k: number) => ((k % 16) + 16) % 16;
  face("table", 0, [...T]);
  for (let i = 0; i < 8; i++) face("star", i, [T[i], T[m8(i + 1)], S[i]]);
  for (let i = 0; i < 8; i++) face("bezel", i, [T[i], S[m8(i - 1)], GT[2 * i], S[i]]);
  for (let i = 0; i < 8; i++) {
    face("upperGirdle", 2 * i, [S[i], GT[2 * i], GT[2 * i + 1]]);
    face("upperGirdle", 2 * i + 1, [S[i], GT[2 * i + 1], GT[m16(2 * i + 2)]]);
  }
  for (let k = 0; k < 16; k++) face("girdle", k, [GT[k], GB[k], GB[m16(k + 1)], GT[m16(k + 1)]]);
  for (let i = 0; i < 8; i++) {
    face("lowerGirdle", 2 * i, [Q[i], GB[2 * i], GB[2 * i + 1]]);
    face("lowerGirdle", 2 * i + 1, [Q[i], GB[2 * i + 1], GB[m16(2 * i + 2)]]);
  }
  for (let i = 0; i < 8; i++) face("pavilion", i, [GB[2 * i], Q[m8(i - 1)], C[m8(i - 1)], C[i], Q[i]]);
  face("culet", 0, [...C]);

  // 向きを揃える: 表から見て反時計回り＝面の法線が体の中心から外を向く。逆なら並びを裏返す
  const body: Vec3 = [0, 0, 0];
  for (let v = 0; v < nV; v++) { body[0] += fine[v * 3]; body[1] += fine[v * 3 + 1]; body[2] += fine[v * 3 + 2]; }
  body[0] /= nV; body[1] /= nV; body[2] /= nV;
  const n: Vec3 = [0, 0, 0], c: Vec3 = [0, 0, 0];
  for (let f = 0; f < faces.length; f++) {
    newell(faces[f].verts, fine, n);
    centroid(faces[f].verts, fine, c);
    if (n[0] * (c[0] - body[0]) + n[1] * (c[1] - body[1]) + n[2] * (c[2] - body[2]) < 0) faces[f].verts.reverse();
  }

  // ─── 原石: 各頂点を、ダイヤを包むゴツゴツした塊の表面へ移す ───
  // ダイヤの頂点は腰（高さ0付近）に32個も集まっているので、原点からまっすぐ外へ押すだけだと
  // 「腰がいちばん太く、下はとがった円すい」＝ダイヤの形のまま膨らんだだけになる（1回目の見本で確認）。
  // そこで頂点の「高さ」を塊の緯度に置き直す: 腰→塊の赤道付近、テーブル→北へ68度、下の腰の三角の先→南へ47度、尖り→南へ83度。
  // 方角（ぐるりの向き）はそのまま。行き先 = 少しつぶした楕円体 × 大きなこぶ（種から作る5方向のふくらみ・へこみ）× 頂点ごとの細かいでこぼこ。
  // 塊の中心は腰の高さの少し下【仮】（ダイヤは塊の上寄りに入っている）。
  // さらに、原点からの距離がダイヤの位置より ROUGH_MIN_PUSH 以上遠くなるまで外へ押す（＝必ずダイヤを包む。test-stone-geometry.mjs で確認）
  const rng = mulberry32(seed);
  const lumps: { u: Vec3; a: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const z = rng() * 2 - 1, t = rng() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    lumps.push({ u: [s * Math.cos(t), z, s * Math.sin(t)], a: rng() * 2 - 1 });
  }
  const yCenter = ROUGH_CENTER_Y - mid; // 塊の中心の高さ（原点を移した後の座標）
  const deg = Math.PI / 180;
  const rough = new Float32Array(fine.length);
  let roughRadius = 0;
  for (let v = 0; v < nV; v++) {
    const x = fine[v * 3], y0 = fine[v * 3 + 1] + mid, z = fine[v * 3 + 2]; // y0 = 腰を0とした高さ
    // 緯度の置き直し
    let lat: number;
    if (y0 >= 0) lat = (4 + 64 * Math.max(0, (y0 - GIRDLE_HALF) / (yTable - GIRDLE_HALF))) * deg;
    else lat = -(4 + 84 * Math.pow(Math.max(0, (-y0 - GIRDLE_HALF) / (-yApex - GIRDLE_HALF)), 2.6)) * deg;
    lat += (rng() * 2 - 1) * ROUGH_ANGLE_JITTER;
    const h = Math.hypot(x, z);
    const az = (h > 1e-9 ? Math.atan2(z, x) : 0) + ((rng() * 2 - 1) * ROUGH_ANGLE_JITTER) / Math.max(0.3, Math.cos(lat));
    const dx = Math.cos(lat) * Math.cos(az), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(az);
    let lump = 0;
    for (const L of lumps) {
      const d = dx * L.u[0] + dy * L.u[1] + dz * L.u[2];
      lump += L.a * d * d * d; // 片側だけにふくらむ（反対側は同じだけへこむ）
    }
    // 楕円体の、その方向での半径
    const ex = dx / ROUGH_SQUASH[0], ey = dy / ROUGH_SQUASH[1], ez = dz / ROUGH_SQUASH[2];
    const ellipse = 1 / Math.hypot(ex, ey, ez);
    const dist = ROUGH_R * ellipse * (1 + ROUGH_LUMP * lump) + (rng() * 2 - 1) * ROUGH_JITTER;
    let px = dx * dist, py = yCenter + dy * dist, pz = dz * dist;
    // 原点から見てダイヤの位置より近ければ、その方向へ押し足す
    const fineLen = Math.hypot(x, fine[v * 3 + 1], z);
    const pl = Math.hypot(px, py, pz) || 1e-6;
    if (pl < fineLen + ROUGH_MIN_PUSH) { const k = (fineLen + ROUGH_MIN_PUSH) / pl; px *= k; py *= k; pz *= k; }
    rough[v * 3] = px; rough[v * 3 + 1] = py; rough[v * 3 + 2] = pz;
  }
  // 包み直し: 原石の面は大きく平らでないので、頂点が外にあっても面の途中がダイヤに食い込むことがある（こぶを強くした時に確認）。
  // 原点からダイヤの頂点・面の中心・縁の中点へ光線を出し、原石の面（扇形の三角・描く時と同じ分け方）に先に当たったら、
  // その面の頂点を外へ押し広げる。食い込みが無くなるまで繰り返す（種を変えても必ず包む）
  const probes: number[] = [];
  const cc: Vec3 = [0, 0, 0];
  for (let v = 0; v < nV; v++) probes.push(fine[v * 3], fine[v * 3 + 1], fine[v * 3 + 2]);
  for (const f of faces) { centroid(f.verts, fine, cc); probes.push(cc[0], cc[1], cc[2]); }
  for (const f of faces) for (let i = 0; i < f.verts.length; i++) {
    const a = f.verts[i] * 3, b = f.verts[(i + 1) % f.verts.length] * 3;
    probes.push((fine[a] + fine[b]) / 2, (fine[a + 1] + fine[b + 1]) / 2, (fine[a + 2] + fine[b + 2]) / 2);
  }
  const hit = { t: 0, face: -1 };
  for (let round = 0; round < 50; round++) {
    let moved = false;
    for (let p = 0; p < probes.length; p += 3) {
      const l = Math.hypot(probes[p], probes[p + 1], probes[p + 2]);
      if (l < 1e-6) continue;
      rayHitFan(rough, faces, probes[p] / l, probes[p + 1] / l, probes[p + 2] / l, hit);
      if (hit.face < 0 || hit.t >= l + CONTAIN_MARGIN) continue;
      const k = (l + CONTAIN_MARGIN * 1.5) / hit.t;
      for (const v of faces[hit.face].verts) { rough[v * 3] *= k; rough[v * 3 + 1] *= k; rough[v * 3 + 2] *= k; }
      moved = true;
    }
    if (!moved) break;
  }
  for (let v = 0; v < nV; v++) roughRadius = Math.max(roughRadius, Math.hypot(rough[v * 3], rough[v * 3 + 1], rough[v * 3 + 2]));

  // ─── 削れる順番 ───
  // 同じ種類の中はビット反転の順（周方向に散らす）。種は「どこから削り始めるか」を回すだけ。
  // 種類どうしは交互に並べ、全体を範囲の中に等間隔で置く（同じ値は2つと無い）
  const rot16 = Math.floor(rng() * 16), rot8 = Math.floor(rng() * 8);
  const br16 = bitReverseOrder(16), br8 = bitReverseOrder(8);
  const find = (kind: FaceKind, slot: number) => {
    for (let f = 0; f < faces.length; f++) if (faces[f].kind === kind && slots[f] === slot) return f;
    throw new Error(`面が見つからない: ${kind} ${slot}`);
  };
  const spread = (list: number[], [a, b]: [number, number]) => {
    list.forEach((f, i) => { faces[f].cutRank = a + ((b - a) * i) / Math.max(1, list.length - 1); });
  };
  // 腰まわり: 上の腰の三角・腰の帯を1枚ずつ交互に。2種類の出発点はずらす【仮】
  const girdleOrder: number[] = [];
  for (let j = 0; j < 16; j++) {
    girdleOrder.push(find("upperGirdle", (br16[j] + rot16) % 16));
    girdleOrder.push(find("girdle", (br16[j] + rot16 + 11) % 16));
  }
  spread(girdleOrder, RANK_GIRDLE);
  // 上下の大きな面: 凧形 → 下の腰の三角 → パビリオン → スター → 下の腰の三角 の繰り返し【仮】
  // （クラウン16枚・パビリオン8枚・下の腰の三角16枚。上と下が入れ替わりながら削れる）
  const crown: number[] = [];
  for (let j = 0; j < 8; j++) {
    crown.push(find("bezel", (br8[j] + rot8) % 8));
    crown.push(find("star", (br8[j] + rot8 + 3) % 8));
  }
  const mainOrder: number[] = [];
  for (let j = 0; j < 8; j++) {
    mainOrder.push(crown[2 * j]);
    mainOrder.push(find("lowerGirdle", (br16[2 * j] + rot16 + 5) % 16));
    mainOrder.push(find("pavilion", (br8[j] + rot8 + 5) % 8));
    mainOrder.push(crown[2 * j + 1]);
    mainOrder.push(find("lowerGirdle", (br16[2 * j + 1] + rot16 + 5) % 16));
  }
  spread(mainOrder, RANK_MAIN);
  faces[find("table", 0)].cutRank = RANK_TABLE;
  faces[find("culet", 0)].cutRank = RANK_CULET;

  return { fine, rough, faces, roughRadius };
}

// ─── 毎コマの形 ──────────────

/** 頂点ごとに「その頂点を共有する面」の一覧（詰めた配列）。形ごとに一度だけ作って取っておく */
interface VertexFaces { start: Int32Array; list: Int32Array }
const vertexFacesCache = new WeakMap<StoneMesh, VertexFaces>();
function vertexFaces(mesh: StoneMesh): VertexFaces {
  let vf = vertexFacesCache.get(mesh);
  if (vf) return vf;
  const nV = mesh.fine.length / 3;
  const count = new Int32Array(nV + 1);
  for (const f of mesh.faces) for (const v of f.verts) count[v + 1]++;
  for (let v = 0; v < nV; v++) count[v + 1] += count[v];
  const list = new Int32Array(count[nV]);
  const fill = count.slice(0, nV);
  mesh.faces.forEach((f, fi) => { for (const v of f.verts) list[fill[v]++] = fi; });
  vf = { start: count, list };
  vertexFacesCache.set(mesh, vf);
  return vf;
}

/** 面ごとの削れ具合 cut から、いまの頂点の位置を out に書く。
 *  頂点の削れ量＝その頂点を共有する面の cut の最大値（1で完全にダイヤの位置）。毎コマ呼ぶので新しい配列は作らない */
export function morphVertices(mesh: StoneMesh, cut: Float32Array, out: Float32Array): void {
  const { start, list } = vertexFaces(mesh);
  const { fine, rough } = mesh;
  const nV = fine.length / 3;
  for (let v = 0; v < nV; v++) {
    let k = 0;
    for (let j = start[v]; j < start[v + 1]; j++) { const c = cut[list[j]]; if (c > k) k = c; }
    if (k > 1) k = 1;
    const i = v * 3;
    out[i] = rough[i] + (fine[i] - rough[i]) * k;
    out[i + 1] = rough[i + 1] + (fine[i + 1] - rough[i + 1]) * k;
    out[i + 2] = rough[i + 2] + (fine[i + 2] - rough[i + 2]) * k;
  }
}

/** 面の中心（頂点の平均）を out に書いて返す */
export function faceCenter(mesh: StoneMesh, verts: Float32Array, f: number, out: Vec3): Vec3 {
  return centroid(mesh.faces[f].verts, verts, out);
}

/** 面の外向きの法線（長さ1）を out に書いて返す。原石の面は平らとは限らないので、多角形全体から求める（Newell の方法） */
export function faceNormal(mesh: StoneMesh, verts: Float32Array, f: number, out: Vec3): Vec3 {
  return newell(mesh.faces[f].verts, verts, out);
}

/** 面の縁（頂点番号の組 [a, b]・a<b）。ひびの線を描く時に使う。同じ縁は1回だけ。形ごとに一度だけ作って取っておく */
const edgesCache = new WeakMap<StoneMesh, number[][]>();
export function crackEdges(mesh: StoneMesh): number[][] {
  let e = edgesCache.get(mesh);
  if (e) return e;
  const seen = new Set<number>();
  e = [];
  const nV = mesh.fine.length / 3;
  for (const f of mesh.faces) {
    const vs = f.verts;
    for (let i = 0; i < vs.length; i++) {
      const a = Math.min(vs[i], vs[(i + 1) % vs.length]), b = Math.max(vs[i], vs[(i + 1) % vs.length]);
      const key = a * nV + b;
      if (seen.has(key)) continue;
      seen.add(key);
      e.push([a, b]);
    }
  }
  edgesCache.set(mesh, e);
  return e;
}

// ─── 下請け ──────────────
/** 原点から向き (dx,dy,dz) へ出した光線が、最初に当たる面（扇形の三角で判定）と距離を out に書く。当たらなければ face=-1 */
function rayHitFan(p: Float32Array, faces: StoneFace[], dx: number, dy: number, dz: number, out: { t: number; face: number }): void {
  out.t = Infinity; out.face = -1;
  for (let f = 0; f < faces.length; f++) {
    const vs = faces[f].verts;
    const a = vs[0] * 3;
    for (let i = 1; i + 1 < vs.length; i++) {
      const b = vs[i] * 3, c = vs[i + 1] * 3;
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const tx = -p[a], ty = -p[a + 1], tz = -p[a + 2];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (dx * qx + dy * qy + dz * qz) / det;
      if (w < -1e-6 || u + w > 1 + 1e-6) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t > 0 && t < out.t) { out.t = t; out.face = f; }
    }
  }
}

function centroid(vs: number[], p: Float32Array, out: Vec3): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const v of vs) { x += p[v * 3]; y += p[v * 3 + 1]; z += p[v * 3 + 2]; }
  out[0] = x / vs.length; out[1] = y / vs.length; out[2] = z / vs.length;
  return out;
}
function newell(vs: number[], p: Float32Array, out: Vec3): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i] * 3, b = vs[(i + 1) % vs.length] * 3;
    nx += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
    ny += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
    nz += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}
